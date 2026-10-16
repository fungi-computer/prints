import type { WhistleJsonValue } from "@fungi.computer/whistle";
import * as z from "zod";
import { validateMediaVideoSelection } from "@fungi.computer/darkroom";
import {
  generationCommandSchema,
  generatedMediaSchema,
  methodActorSchema,
  type GenerationCommand,
  type GeneratedMedia,
  type MethodActor,
} from "./method-contracts.js";
import { recordCompletedPrint } from "./print-records.js";

export function ensureMethodGenerationTables(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS method_generations (
    request_id TEXT PRIMARY KEY, actor_kind TEXT NOT NULL CHECK(actor_kind IN ('member','agent')),
    actor_id TEXT NOT NULL, computer_id TEXT NOT NULL, input_json TEXT NOT NULL, result_json TEXT
  ) STRICT`);
}
const json = (value: string): WhistleJsonValue =>
  z.json().parse(JSON.parse(value));
type Row = {
  actor_kind: string;
  actor_id: string;
  computer_id: string;
  input_json: string;
  result_json: string | null;
};
const read = (sql: SqlStorage, requestId: string) =>
  sql
    .exec<Row>(
      "SELECT actor_kind,actor_id,computer_id,input_json,result_json FROM method_generations WHERE request_id=?",
      requestId,
    )
    .toArray()[0];
/** A command has attribution and a pin before dispatch; only Media can fill its destination. */
export function rememberMethodGeneration(
  storage: Pick<DurableObjectStorage, "sql" | "transactionSync">,
  actor: MethodActor,
  computerId: string,
  input: GenerationCommand,
):
  | { kind: "pending" }
  | { kind: "completed"; result: GeneratedMedia }
  | { error: "conflict" } {
  const command = generationCommandSchema.parse(input);
  const author = methodActorSchema.parse(actor);
  return storage.transactionSync(() => {
    const previous = read(storage.sql, command.requestId);
    const encoded = JSON.stringify(command);
    if (previous) {
      if (
        previous.actor_kind !== author.kind ||
        previous.actor_id !== author.id ||
        previous.computer_id !== computerId ||
        previous.input_json !== encoded
      )
        return { error: "conflict" };
      return previous.result_json === null
        ? { kind: "pending" }
        : {
            kind: "completed",
            result: generatedMediaSchema.parse(json(previous.result_json)),
          };
    }
    if (
      storage.sql
        .exec("SELECT print_id FROM prints WHERE print_id=?", command.requestId)
        .toArray().length
    )
      return { error: "conflict" };
    storage.sql.exec(
      "INSERT INTO method_generations(request_id,actor_kind,actor_id,computer_id,input_json) VALUES (?,?,?,?,?)",
      command.requestId,
      author.kind,
      author.id,
      computerId,
      encoded,
    );
    return { kind: "pending" };
  });
}

/** Complete from the remembered actor/input and the admitted Media output in one transaction. */
export function completeMethodGeneration(
  storage: Pick<DurableObjectStorage, "sql" | "transactionSync">,
  actor: MethodActor,
  computerId: string,
  input: GenerationCommand,
  rawResult: GeneratedMedia,
): { kind: "completed"; result: GeneratedMedia } | { error: "conflict" } {
  const result = generatedMediaSchema.parse(rawResult);
  return storage.transactionSync(() => {
    const pending = read(storage.sql, input.requestId);
    if (
      pending?.actor_kind !== actor.kind ||
      pending.actor_id !== actor.id ||
      pending.computer_id !== computerId ||
      pending.input_json !==
        JSON.stringify(generationCommandSchema.parse(input))
    )
      return { error: "conflict" };
    const command = generationCommandSchema.parse(json(pending.input_json));
    if (
      result.destination.computerId !== pending.computer_id ||
      (command.kind === "video"
        ? result.format !== "mp4"
        : command.outputFormat !== undefined &&
          result.format !== command.outputFormat) ||
      result.model !== command.settings.model
    )
      return { error: "conflict" };
    if (pending.result_json !== null)
      return pending.result_json === JSON.stringify(result)
        ? { kind: "completed", result }
        : { error: "conflict" };
    if (
      storage.sql
        .exec("SELECT print_id FROM prints WHERE print_id=?", input.requestId)
        .toArray().length
    )
      return { error: "conflict" };
    const settings = {
      ...(command.kind === "image"
        ? command.settings
        : validateMediaVideoSelection(command.settings)),
      width: result.width,
      height: result.height,
    };
    recordCompletedPrint(storage.sql, {
      printId: command.requestId,
      computerId: pending.computer_id,
      actor: methodActorSchema.parse({
        kind: pending.actor_kind,
        id: pending.actor_id,
      }),
      settings,
      result,
    });
    storage.sql.exec(
      "UPDATE method_generations SET result_json=? WHERE request_id=?",
      JSON.stringify(result),
      command.requestId,
    );
    return { kind: "completed", result };
  });
}
