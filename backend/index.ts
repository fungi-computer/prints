import { defaultMediaLibraryPath } from "../library-folder.js";
import { appBackend, type PrintsMethodContext } from "./methods.js";
import { ensureMethodGenerationTables } from "./method-pending.js";
import { completeGenerationRequestSchema } from "../src/media-completion-contract.js";
import { DurableObject } from "cloudflare:workers";
import * as Schema from "effect/Schema";
import { reportCatchFailure } from "../src/log-event.js";
import {
  appBackendActorHeader,
  appBackendComputerHeader,
} from "@fungi.computer/agar/backend";
import {
  mediaLibraryRequestSchema,
  mediaLibraryResponseSchema,
} from "@fungi.computer/agar/media";
import {
  mediaRecoveryRequestSchema,
  normalizePendingGeneration,
  pendingGenerationSchema,
} from "../src/media-recovery-contract.js";
import {
  mediaFolderSchema,
  mediaSettingsRequestSchema,
  mediaNoticeRequestSchema,
  mediaNoticesSchema,
} from "../src/media-settings.js";
import { completeGeneration } from "./prints-index.js";
import { ensurePrintsIndexTables } from "./print-records.js";

const requestSchema = Schema.Union([
  mediaNoticeRequestSchema,
  mediaSettingsRequestSchema,
  mediaRecoveryRequestSchema,
  mediaLibraryRequestSchema,
  completeGenerationRequestSchema,
]);
const actorSchema = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(256)),
);
const computerHeaderSchema = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(256)),
);
const computerScopeDenied = () =>
  Response.json(
    { error: "Computer is not admitted for this request" },
    { status: 403 },
  );

export type PrintsEnv = PrintsMethodContext["env"];

async function readJsonBody(
  request: Request,
): Promise<
  Readonly<{ kind: "parsed"; value: unknown }> | Readonly<{ kind: "invalid" }>
> {
  try {
    const value: unknown = await request.json();
    return { kind: "parsed", value };
  } catch {
    return { kind: "invalid" };
  }
}

/**
 * Runs inside the existing admitted App instance; no Team settings of its
 * own. Every operation is scoped to one Computer, named only by the Hub's
 * verified `appBackendComputerHeader`: a Computer id read from the request
 * body is untrusted input and is never accepted on its own, because a
 * different installation's caller could otherwise name any Computer and
 * read back its folder, prompts or pending generations.
 */
class PrintsFacet extends DurableObject<PrintsEnv, unknown> {
  declare public readonly env: PrintsEnv;
  declare public readonly ctx: DurableObjectState;
  constructor(ctx: DurableObjectState, env: PrintsEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS dismissed_notices (id INTEGER PRIMARY KEY AUTOINCREMENT, computer_id TEXT NOT NULL, notice_key TEXT NOT NULL, UNIQUE(computer_id, notice_key)) STRICT",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS media_library_folders (computer_id TEXT PRIMARY KEY, path TEXT NOT NULL) STRICT",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS pending_generations (actor_id TEXT NOT NULL, request_id TEXT NOT NULL, computer_id TEXT NOT NULL, record_json TEXT NOT NULL, PRIMARY KEY(actor_id,request_id)) STRICT",
    );
    ensurePrintsIndexTables(ctx.storage.sql);
    ensureMethodGenerationTables(ctx.storage.sql);
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "PUT")
      return new Response(null, { status: 405, headers: { Allow: "PUT" } });
    const rawBody = await readJsonBody(request);
    const decodedBody =
      rawBody.kind === "parsed"
        ? Schema.decodeUnknownOption(requestSchema, {
            onExcessProperty: "error",
          })(rawBody.value)
        : { _tag: "None" as const };
    if (decodedBody._tag === "None") {
      return Response.json(
        { error: "Invalid Prints settings request" },
        { status: 400 },
      );
    }
    const input = decodedBody.value;
    const sql = this.ctx.storage.sql;
    // The Hub overwrites this header from its own verified admission; a
    // Computer id named only in the request body is never trusted instead.
    const verifiedComputer = Schema.decodeUnknownOption(computerHeaderSchema)(
      request.headers.get(appBackendComputerHeader),
    );
    const requireComputer = (computerId: string): Response | null =>
      verifiedComputer._tag === "None" || verifiedComputer.value !== computerId
        ? computerScopeDenied()
        : null;
    if (
      input.operation === "read-notices" ||
      input.operation === "dismiss-notices"
    ) {
      const refused = requireComputer(input.computerId);
      if (refused !== null) return refused;
      if (input.operation === "dismiss-notices") {
        for (const key of input.keys)
          sql.exec(
            "INSERT OR IGNORE INTO dismissed_notices(computer_id,notice_key) VALUES (?,?)",
            input.computerId,
            key,
          );
        sql.exec(
          "DELETE FROM dismissed_notices WHERE computer_id=? AND id NOT IN (SELECT id FROM dismissed_notices WHERE computer_id=? ORDER BY id DESC LIMIT 200)",
          input.computerId,
          input.computerId,
        );
      }
      const keys = sql
        .exec<{ notice_key: string }>(
          "SELECT notice_key FROM dismissed_notices WHERE computer_id=? ORDER BY id ASC LIMIT 200",
          input.computerId,
        )
        .toArray()
        .map((row) => row.notice_key);
      return Response.json(
        Schema.decodeUnknownSync(mediaNoticesSchema)({ keys }),
      );
    }
    if (
      input.operation !== "read-folder" &&
      input.operation !== "read-library" &&
      input.operation !== "select-folder"
    ) {
      const actor = Schema.decodeUnknownOption(actorSchema)(
        request.headers.get(appBackendActorHeader),
      );
      if (actor._tag === "None")
        return Response.json(
          { error: "App actor unavailable" },
          { status: 403 },
        );
      if (input.operation === "remember-generation") {
        let record;
        try {
          record = normalizePendingGeneration(input.record);
        } catch (cause) {
          reportCatchFailure("remember-generation-input", cause);
          return Response.json(
            { error: "Invalid generation reference" },
            { status: 400 },
          );
        }
        const refused = requireComputer(record.reference.computerId);
        if (refused !== null) return refused;
        const encoded = JSON.stringify(record);
        sql.exec(
          "INSERT OR IGNORE INTO pending_generations(actor_id,request_id,computer_id,record_json) VALUES (?,?,?,?)",
          actor.value,
          record.reference.requestId,
          record.reference.computerId,
          encoded,
        );
        const stored = sql
          .exec<{ record_json: string }>(
            "SELECT record_json FROM pending_generations WHERE actor_id=? AND request_id=?",
            actor.value,
            record.reference.requestId,
          )
          .one();
        if (stored.record_json !== encoded)
          return Response.json(
            { error: "Generation reference already has another input" },
            { status: 409 },
          );
        return Response.json(record);
      }
      if (input.operation === "forget-generation") {
        const refused = requireComputer(input.reference.computerId);
        if (refused !== null) return refused;
        sql.exec(
          "DELETE FROM pending_generations WHERE actor_id=? AND request_id=? AND computer_id=?",
          actor.value,
          input.reference.requestId,
          input.reference.computerId,
        );
        return Response.json({ removed: true });
      }
      if (input.operation === "complete-generation") {
        const refused = requireComputer(input.reference.computerId);
        if (refused !== null) return refused;
        const outcome = completeGeneration(
          this.ctx.storage,
          actor.value,
          input,
        );
        if (outcome.kind === "actor-mismatch")
          return Response.json(
            { error: "Generation actor mismatch" },
            { status: 403 },
          );
        if (outcome.kind === "no-pending-generation")
          return Response.json(
            { error: "No remembered generation matches this reference" },
            { status: 400 },
          );
        if (outcome.kind === "conflict")
          return Response.json(
            { error: "A different print already completed this reference" },
            { status: 409 },
          );
        return Response.json(outcome.print);
      }
      // list-generations: scoped to the verified Computer, never every
      // Computer this actor has ever generated on from this installation.
      if (verifiedComputer._tag === "None") return computerScopeDenied();
      // Bounded pages do not impose a lifetime limit on accepted generations.
      const rows = sql
        .exec<{ request_id: string; record_json: string }>(
          "SELECT request_id,record_json FROM pending_generations WHERE actor_id=? AND computer_id=? AND request_id>? ORDER BY request_id LIMIT 51",
          actor.value,
          verifiedComputer.value,
          input.after ?? "",
        )
        .toArray();
      const page = rows.slice(0, 50);
      return Response.json({
        records: page.map((row) =>
          normalizePendingGeneration(
            Schema.decodeUnknownSync(
              Schema.fromJsonString(pendingGenerationSchema),
              { onExcessProperty: "error" },
            )(row.record_json),
          ),
        ),
        next: rows.length > 50 ? (page.at(-1)?.request_id ?? null) : null,
      });
    }
    const refused = requireComputer(input.computerId);
    if (refused !== null) return refused;
    if (input.operation === "select-folder")
      sql.exec(
        "INSERT INTO media_library_folders (computer_id,path) VALUES (?,?) ON CONFLICT(computer_id) DO UPDATE SET path=excluded.path",
        input.computerId,
        input.path,
      );
    const row = sql
      .exec<{ path: string }>(
        "SELECT path FROM media_library_folders WHERE computer_id=?",
        input.computerId,
      )
      .toArray()[0];
    return Response.json(
      Schema.decodeUnknownSync(
        input.operation === "read-library"
          ? mediaLibraryResponseSchema
          : mediaFolderSchema,
      )(
        input.operation === "read-library"
          ? { path: row?.path ?? null }
          : {
              path: row?.path ?? defaultMediaLibraryPath,
              configured: row !== undefined,
            },
      ),
    );
  }
}

export const Prints = appBackend.implement(PrintsFacet);
