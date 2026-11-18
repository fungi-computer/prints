import { AppMethodRefusal } from "@fungi.computer/agar/backend";
import { defineAppMethod } from "@fungi.computer/agar/backend-definition";
import {
  mediaLibraryInputSchema,
  mediaLibraryMethod,
  mediaLibraryResponseSchema,
} from "@fungi.computer/agar/media";
import type { AppMethodCallContext } from "@fungi.computer/puffball/app-method-runtime";
import * as Schema from "effect/Schema";
import * as z from "zod";
import { defaultMediaLibraryPath } from "../library-folder.js";
import {
  MAX_GENERATIONS_IN_FLIGHT,
  generationHoldMs,
  generationLimitRefusal,
} from "../src/generation-limit.js";
import { completeGenerationRequestSchema } from "../src/media-completion-contract.js";
import {
  failGenerationInputSchema,
  forgetGenerationInputSchema,
  listGenerationsInputSchema,
  normalizePendingGeneration,
  type PendingGeneration,
  pendingGenerationSchema,
  rememberGenerationInputSchema,
} from "../src/media-recovery-contract.js";
import {
  computerInputSchema,
  dismissNoticesInputSchema,
  mediaFolderSchema,
  mediaNoticesSchema,
  selectFolderInputSchema,
} from "../src/media-settings.js";
import { memberMethods } from "../src/member-methods.js";
import {
  deleteCharacterInputSchema,
  saveCharacterInputSchema,
} from "../src/prompt-characters.js";
import {
  deleteStyleInputSchema,
  readPrintStyleInputSchema,
  saveStyleInputSchema,
} from "../src/prompt-styles.js";
import type { PrintsMethodContext } from "./methods.js";
import { completeGeneration } from "./prints-index.js";
import type { PrintRecord } from "./print-records.js";
import {
  deletePromptCharacter,
  listPromptCharacters,
  savePromptCharacter,
} from "./prompt-characters.js";
import {
  deletePromptStyle,
  listPromptStyles,
  printStyleAt,
  savePromptStyle,
} from "./prompt-styles.js";

/**
 * Every operation Prints' own window and the Hub Media library perform for a
 * signed-in member. The host attests the member and the Computer in the caller
 * context; the input may only repeat that Computer, never choose another. The
 * input is decoded by the same Effect schemas the callers encode with.
 */
const wire = z.record(z.string(), z.unknown());
const reply = z.record(z.string(), z.unknown());
type Wire = z.output<typeof wire>;
type Reply = z.output<typeof reply>;
const hidden = { hidden: true as const, requires: [] };

/** The JSON a caller reads: fields that are undefined are absent, as on the wire. */
const plain = (value: PendingGeneration | PrintRecord): Reply =>
  reply.parse(JSON.parse(JSON.stringify(value)));

type Sql = PrintsMethodContext["ctx"]["storage"]["sql"];

function decode<S extends Schema.Decoder<unknown>>(
  schema: S,
  value: Wire,
): S["Type"] {
  const decoded = Schema.decodeUnknownOption(schema, {
    onExcessProperty: "error",
  })(value);
  if (decoded._tag === "None")
    throw new AppMethodRefusal("invalid", "Invalid Prints request");
  return decoded.value;
}

/** The attested member and Computer; a named Computer must be that one. */
function admitted(caller: AppMethodCallContext, computerId?: string) {
  if (caller.actor.kind !== "member")
    throw new AppMethodRefusal("forbidden", "App actor unavailable");
  if (
    caller.computerId === null ||
    (computerId !== undefined && caller.computerId !== computerId)
  )
    throw new AppMethodRefusal(
      "forbidden",
      "Computer is not admitted for this request",
    );
  return { memberId: caller.actor.memberId, computerId: caller.computerId };
}

const noticeKeys = (sql: Sql, computerId: string) =>
  sql
    .exec<{ notice_key: string }>(
      "SELECT notice_key FROM dismissed_notices WHERE computer_id=? ORDER BY id ASC LIMIT 200",
      computerId,
    )
    .toArray()
    .map((row) => row.notice_key);

const folderPath = (sql: Sql, computerId: string) =>
  sql
    .exec<{ path: string }>(
      "SELECT path FROM media_library_folders WHERE computer_id=?",
      computerId,
    )
    .toArray()[0]?.path;

const folderReply = (sql: Sql, computerId: string) => {
  const path = folderPath(sql, computerId);
  return Schema.encodeSync(mediaFolderSchema)({
    path: path ?? defaultMediaLibraryPath,
    configured: path !== undefined,
  });
};

const storedRecord = (json: string) =>
  normalizePendingGeneration(
    Schema.decodeUnknownSync(Schema.fromJsonString(pendingGenerationSchema), {
      onExcessProperty: "error",
    })(json),
  );

export const memberBackendMethods = {
  [memberMethods.readNotices]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "Read the dismissed Prints notices for the caller's Computer.",
    effect: "read",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const { computerId } = admitted(
        caller,
        decode(computerInputSchema, raw).computerId,
      );
      return Schema.encodeSync(mediaNoticesSchema)({
        keys: noticeKeys(context.ctx.storage.sql, computerId),
      });
    },
  }),
  [memberMethods.dismissNotices]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "Dismiss Prints notices for the caller's Computer.",
    effect: "write",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const input = decode(dismissNoticesInputSchema, raw);
      const { computerId } = admitted(caller, input.computerId);
      const sql = context.ctx.storage.sql;
      for (const key of input.keys)
        sql.exec(
          "INSERT OR IGNORE INTO dismissed_notices(computer_id,notice_key) VALUES (?,?)",
          computerId,
          key,
        );
      sql.exec(
        "DELETE FROM dismissed_notices WHERE computer_id=? AND id NOT IN (SELECT id FROM dismissed_notices WHERE computer_id=? ORDER BY id DESC LIMIT 200)",
        computerId,
        computerId,
      );
      return Schema.encodeSync(mediaNoticesSchema)({
        keys: noticeKeys(sql, computerId),
      });
    },
  }),
  [memberMethods.listStyles]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "List saved Prints styles for the member's window.",
    effect: "read",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      admitted(caller, decode(computerInputSchema, raw).computerId);
      return { styles: listPromptStyles(context.ctx.storage.sql) };
    },
  }),
  [memberMethods.saveStyle]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "Create or rewrite one saved Prints style.",
    effect: "write",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const input = decode(saveStyleInputSchema, raw);
      admitted(caller, input.computerId);
      const sql = context.ctx.storage.sql;
      const outcome = savePromptStyle(sql, input);
      if (outcome.kind === "name-taken")
        throw new AppMethodRefusal(
          "conflict",
          "A style with this name already exists",
        );
      if (outcome.kind === "full")
        throw new AppMethodRefusal(
          "conflict",
          "Delete a style before saving another",
        );
      if (outcome.kind === "not-found")
        throw new AppMethodRefusal("not_found", "Style not found");
      return { styles: listPromptStyles(sql) };
    },
  }),
  [memberMethods.deleteStyle]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "Delete one saved Prints style.",
    effect: "write",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const input = decode(deleteStyleInputSchema, raw);
      admitted(caller, input.computerId);
      const sql = context.ctx.storage.sql;
      deletePromptStyle(sql, input.id);
      return { styles: listPromptStyles(sql) };
    },
  }),
  [memberMethods.readPrintStyle]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "Read the style recorded on the print at one Computer path.",
    effect: "read",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const input = decode(readPrintStyleInputSchema, raw);
      const { computerId } = admitted(caller, input.computerId);
      return {
        style: printStyleAt(context.ctx.storage.sql, computerId, input.path),
      };
    },
  }),
  [memberMethods.listCharacters]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "List saved Prints characters for the member's window.",
    effect: "read",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      admitted(caller, decode(computerInputSchema, raw).computerId);
      return { characters: listPromptCharacters(context.ctx.storage.sql) };
    },
  }),
  [memberMethods.saveCharacter]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "Create or rewrite one saved Prints character.",
    effect: "write",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const input = decode(saveCharacterInputSchema, raw);
      admitted(caller, input.computerId);
      const sql = context.ctx.storage.sql;
      const outcome = savePromptCharacter(sql, input);
      if (outcome.kind === "name-taken")
        throw new AppMethodRefusal(
          "conflict",
          "A character with this name already exists",
        );
      if (outcome.kind === "full")
        throw new AppMethodRefusal(
          "conflict",
          "Delete a character before saving another",
        );
      if (outcome.kind === "not-found")
        throw new AppMethodRefusal("not_found", "Character not found");
      return { characters: listPromptCharacters(sql) };
    },
  }),
  [memberMethods.deleteCharacter]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "Delete one saved Prints character.",
    effect: "write",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const input = decode(deleteCharacterInputSchema, raw);
      admitted(caller, input.computerId);
      const sql = context.ctx.storage.sql;
      deletePromptCharacter(sql, input.id);
      return { characters: listPromptCharacters(sql) };
    },
  }),
  [memberMethods.readFolder]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "Read the library folder chosen for the caller's Computer.",
    effect: "read",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const { computerId } = admitted(
        caller,
        decode(computerInputSchema, raw).computerId,
      );
      return folderReply(context.ctx.storage.sql, computerId);
    },
  }),
  [memberMethods.selectFolder]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "Choose the library folder for the caller's Computer.",
    effect: "write",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const input = decode(selectFolderInputSchema, raw);
      const { computerId } = admitted(caller, input.computerId);
      const sql = context.ctx.storage.sql;
      sql.exec(
        "INSERT INTO media_library_folders (computer_id,path) VALUES (?,?) ON CONFLICT(computer_id) DO UPDATE SET path=excluded.path",
        computerId,
        input.path,
      );
      return folderReply(sql, computerId);
    },
  }),
  [mediaLibraryMethod]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description:
      "Read the library folder this Media App exposes to other Apps for the caller's Computer.",
    effect: "read",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const { computerId } = admitted(
        caller,
        decode(mediaLibraryInputSchema, raw).computerId,
      );
      return Schema.encodeSync(mediaLibraryResponseSchema)({
        path: folderPath(context.ctx.storage.sql, computerId) ?? null,
      });
    },
  }),
  [memberMethods.rememberGeneration]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "Remember one generation command so a reload can recover it.",
    effect: "write",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const record = normalizePendingGeneration(
        decode(rememberGenerationInputSchema, raw).record,
      );
      const { memberId } = admitted(caller, record.reference.computerId);
      const sql = context.ctx.storage.sql;
      const encoded = JSON.stringify(record);
      // A run that is already in flight is a replay; a new or retried run
      // needs room under the person's limit, whichever tab asks. A run holds
      // its place until it finishes or fails, or until no run can still be
      // going. A stopped run holds it too: Stop ends the waiting, not the
      // paid provider call.
      const now = Date.now();
      sql.exec(
        "DELETE FROM pending_generations WHERE dismissed=1 AND created_at<=?",
        now - generationHoldMs,
      );
      const counted = sql
        .exec<{ others: number; self: number }>(
          `SELECT
             COALESCE(SUM(request_id<>?),0) AS others,
             COALESCE(SUM(request_id=?),0) AS self
           FROM pending_generations
           WHERE actor_id=? AND created_at>?
             AND (json_extract(record_json,'$.failure') IS NULL
               OR json_extract(record_json,'$.failure.reason')='CANCELLED')`,
          record.reference.requestId,
          record.reference.requestId,
          memberId,
          now - generationHoldMs,
        )
        .one();
      if (counted.self === 0 && counted.others >= MAX_GENERATIONS_IN_FLIGHT)
        // A value, not a refusal: the caller shows this copy as it is.
        return generationLimitRefusal;
      sql.exec(
        "INSERT OR IGNORE INTO pending_generations(actor_id,request_id,computer_id,record_json,created_at) VALUES (?,?,?,?,?)",
        memberId,
        record.reference.requestId,
        record.reference.computerId,
        encoded,
        now,
      );
      const stored = sql
        .exec<{ record_json: string }>(
          "SELECT record_json FROM pending_generations WHERE actor_id=? AND request_id=?",
          memberId,
          record.reference.requestId,
        )
        .one();
      if (stored.record_json !== encoded) {
        // A retry re-remembers the same command; only a recorded failure may differ.
        const previous = storedRecord(stored.record_json);
        if (
          previous.failure === undefined ||
          JSON.stringify({ ...previous, failure: undefined }) !== encoded
        )
          throw new AppMethodRefusal(
            "conflict",
            "Generation reference already has another input",
          );
        sql.exec(
          "UPDATE pending_generations SET record_json=? WHERE actor_id=? AND request_id=?",
          encoded,
          memberId,
          record.reference.requestId,
        );
      }
      // Remembering again means the run starts now. Only an accepted
      // remember restarts the window, never one refused above.
      sql.exec(
        "UPDATE pending_generations SET created_at=?, dismissed=0 WHERE actor_id=? AND request_id=?",
        now,
        memberId,
        record.reference.requestId,
      );
      return plain(record);
    },
  }),
  [memberMethods.failGeneration]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "Record why a remembered generation failed.",
    effect: "write",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const input = decode(failGenerationInputSchema, raw);
      const { memberId } = admitted(caller, input.reference.computerId);
      const sql = context.ctx.storage.sql;
      const row = sql
        .exec<{ record_json: string }>(
          "SELECT record_json FROM pending_generations WHERE actor_id=? AND request_id=? AND computer_id=?",
          memberId,
          input.reference.requestId,
          input.reference.computerId,
        )
        .toArray()[0];
      if (row === undefined)
        throw new AppMethodRefusal(
          "not_found",
          "No remembered generation matches this reference",
        );
      const failed = normalizePendingGeneration({
        ...Schema.decodeUnknownSync(
          Schema.fromJsonString(pendingGenerationSchema),
          { onExcessProperty: "error" },
        )(row.record_json),
        failure: input.failure,
      });
      const encoded = JSON.stringify(failed);
      sql.exec(
        "UPDATE pending_generations SET record_json=? WHERE actor_id=? AND request_id=? AND computer_id=?",
        encoded,
        memberId,
        input.reference.requestId,
        input.reference.computerId,
      );
      return plain(failed);
    },
  }),
  [memberMethods.forgetGeneration]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "Forget one remembered generation.",
    effect: "write",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const input = decode(forgetGenerationInputSchema, raw);
      const { memberId } = admitted(caller, input.reference.computerId);
      const sql = context.ctx.storage.sql;
      // Dismissing a stopped run hides it but does not free its place:
      // its provider call may still be going. It frees at the end of the hold.
      sql.exec(
        `UPDATE pending_generations SET dismissed=1
         WHERE actor_id=? AND request_id=? AND computer_id=? AND created_at>?
           AND json_extract(record_json,'$.failure.reason')='CANCELLED'`,
        memberId,
        input.reference.requestId,
        input.reference.computerId,
        Date.now() - generationHoldMs,
      );
      sql.exec(
        "DELETE FROM pending_generations WHERE actor_id=? AND request_id=? AND computer_id=? AND dismissed=0",
        memberId,
        input.reference.requestId,
        input.reference.computerId,
      );
      return { removed: true };
    },
  }),
  [memberMethods.completeGeneration]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description: "Turn a remembered generation into a saved print.",
    effect: "write",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const input = decode(completeGenerationRequestSchema, raw);
      const { memberId } = admitted(caller, input.reference.computerId);
      const outcome = completeGeneration(context.ctx.storage, memberId, input);
      if (outcome.kind === "actor-mismatch")
        throw new AppMethodRefusal("forbidden", "Generation actor mismatch");
      if (outcome.kind === "no-pending-generation")
        throw new AppMethodRefusal(
          "invalid",
          "No remembered generation matches this reference",
        );
      if (outcome.kind === "conflict")
        throw new AppMethodRefusal(
          "conflict",
          "A different print already completed this reference",
        );
      return plain(outcome.print);
    },
  }),
  [memberMethods.listGenerations]: defineAppMethod<
    typeof wire,
    typeof reply,
    PrintsMethodContext
  >({
    ...hidden,
    description:
      "List the member's remembered generations on the caller's Computer.",
    effect: "read",
    input: wire,
    output: reply,
    handler: (raw, context, caller) => {
      const input = decode(listGenerationsInputSchema, raw);
      const { memberId, computerId } = admitted(caller);
      // Bounded pages do not impose a lifetime limit on accepted generations.
      const rows = context.ctx.storage.sql
        .exec<{ request_id: string; record_json: string }>(
          "SELECT request_id,record_json FROM pending_generations WHERE actor_id=? AND computer_id=? AND dismissed=0 AND request_id>? ORDER BY request_id LIMIT 51",
          memberId,
          computerId,
          input.after ?? "",
        )
        .toArray();
      const page = rows.slice(0, 50);
      return {
        records: page.map((row) => plain(storedRecord(row.record_json))),
        next: rows.length > 50 ? (page.at(-1)?.request_id ?? null) : null,
      };
    },
  }),
};
