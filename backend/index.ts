import { appBackend, type PrintsMethodContext } from "./methods.js";
import { ensureMethodGenerationTables } from "./method-pending.js";
import { DurableObject } from "cloudflare:workers";
import { ensurePrintsIndexTables } from "./print-records.js";
import { ensurePromptStyleTables } from "./prompt-styles.js";

export type PrintsEnv = PrintsMethodContext["env"];

/**
 * Runs inside the existing admitted App instance; no Team settings of its
 * own. It serves only declared App methods: the host attests the member and
 * the Computer in each call's caller context, and a Computer id in a method's
 * input is accepted only when it names that Computer.
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
      "CREATE TABLE IF NOT EXISTS pending_generations (actor_id TEXT NOT NULL, request_id TEXT NOT NULL, computer_id TEXT NOT NULL, record_json TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0, dismissed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(actor_id,request_id)) STRICT",
    );
    // Rows remembered before the limit have no start time (0 reads as long
    // finished) and are not dismissed; their record_json is untouched.
    const known = ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(pending_generations)")
      .toArray()
      .map((column) => column.name);
    for (const column of ["created_at", "dismissed"])
      if (!known.includes(column))
        ctx.storage.sql.exec(
          `ALTER TABLE pending_generations ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`,
        );
    ensurePrintsIndexTables(ctx.storage.sql);
    ensurePromptStyleTables(ctx.storage.sql);
    ensureMethodGenerationTables(ctx.storage.sql);
  }
}

export const Prints = appBackend.implement(PrintsFacet);
