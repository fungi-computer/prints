import * as Schema from "effect/Schema";
import type { CompleteGenerationRequest } from "../src/media-completion-contract.js";
import {
  normalizePendingGeneration,
  pendingGenerationSchema,
} from "../src/media-recovery-contract.js";

import {
  readPrint,
  recordCompletedPrint,
  type PrintRecord,
} from "./print-records.js";

/** Only the fields a replay must agree on; `derivedFrom`/`references` are
 * Prints' own lineage, not part of the Hub-admitted result. */
function sameCompletion(
  sql: SqlStorage,
  existing: PrintRecord,
  input: CompleteGenerationRequest,
): boolean {
  return (
    existing.computerId === input.reference.computerId &&
    existing.computerId === input.result.destination.computerId &&
    sql
      .exec(
        "SELECT print_id FROM print_files WHERE computer_id=? AND path=? AND print_id=?",
        input.reference.computerId,
        input.result.destination.path,
        existing.printId,
      )
      .toArray().length === 1 &&
    existing.model === input.result.model &&
    existing.width === input.result.width &&
    existing.height === input.result.height &&
    existing.format === input.result.format &&
    existing.bytes === input.result.bytes &&
    existing.costMilliunits === input.result.costMilliunits
  );
}

export type CompleteGenerationOutcome =
  | Readonly<{ kind: "completed"; print: PrintRecord }>
  | Readonly<{ kind: "conflict" }>
  | Readonly<{ kind: "actor-mismatch" }>
  | Readonly<{ kind: "no-pending-generation" }>;

/**
 * Promote a remembered generation to a `prints` row, atomically and
 * idempotently per (actor, requestId): a completed generation leaves
 * exactly one `prints` row and no pending row; a byte-identical replay is a
 * no-op; a replay that disagrees with the already-recorded print is a
 * conflict, never a silent overwrite.
 */
export function completeGeneration(
  storage: Pick<DurableObjectStorage, "sql" | "transactionSync">,
  actorId: string,
  input: CompleteGenerationRequest,
): CompleteGenerationOutcome {
  return storage.transactionSync(() => {
    const sql = storage.sql;
    const printId = input.reference.requestId;
    const existing = readPrint(sql, printId);
    if (
      existing !== null &&
      (existing.actorId !== actorId || existing.actorKind !== "member")
    )
      return { kind: "actor-mismatch" };
    const pendingRow = sql
      .exec<{ record_json: string }>(
        "SELECT record_json FROM pending_generations WHERE actor_id=? AND request_id=? AND computer_id=?",
        actorId,
        printId,
        input.reference.computerId,
      )
      .toArray()[0];
    const pending =
      pendingRow === undefined
        ? null
        : normalizePendingGeneration(
            Schema.decodeUnknownSync(
              Schema.fromJsonString(pendingGenerationSchema),
              {
                onExcessProperty: "error",
              },
            )(pendingRow.record_json),
          );
    if (
      input.result.destination.computerId !== input.reference.computerId ||
      (pending !== null &&
        input.result.destination.path !== pending.input.destination.path)
    )
      return { kind: "conflict" };
    if (existing !== null) {
      if (!sameCompletion(sql, existing, input)) return { kind: "conflict" };
      // A lost acknowledgement may re-remember this same admitted command.
      sql.exec(
        "DELETE FROM pending_generations WHERE actor_id=? AND request_id=? AND computer_id=?",
        actorId,
        printId,
        input.reference.computerId,
      );
      return { kind: "completed", print: existing };
    }
    if (pending === null) return { kind: "no-pending-generation" };
    const print = recordCompletedPrint(sql, {
      printId,
      computerId: input.reference.computerId,
      actor: { kind: "member", id: actorId },
      settings: pending.input.settings,
      result: input.result,
      derivedFrom: input.derivedFrom,
      references: input.references,
      typed: pending.typed,
      style: pending.style,
      characters: pending.characters,
    });
    sql.exec(
      "DELETE FROM pending_generations WHERE actor_id=? AND request_id=? AND computer_id=?",
      actorId,
      printId,
      input.reference.computerId,
    );
    return { kind: "completed", print };
  });
}
