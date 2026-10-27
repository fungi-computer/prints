import * as z from "zod";
import { printRecordSchema } from "../src/print-record-schema.js";
export { printRecordSchema } from "../src/print-record-schema.js";
import type { MediaGenerationInput } from "@fungi.computer/agar/media";
import type { CompleteGenerationRequest } from "../src/media-completion-contract.js";
import { recordPrintStyle } from "./prompt-styles.js";
import {
  ensurePromptCharacterTables,
  printCharacters,
  recordPrintCharacters,
} from "./prompt-characters.js";

const text = (maximum: number) => z.string().min(1).max(maximum);
export type PrintRecord = Readonly<{
  printId: string;
  computerId: string;
  kind: "image" | "video";
  prompt: string;
  model: string;
  width: number | null;
  height: number | null;
  steps: number | null;
  durationSeconds: number | null;
  format: string;
  bytes: number;
  costMilliunits: number;
  actorKind: "member" | "agent";
  actorId: string;
  derivedFrom: string | null;
  createdAt: number;
  source: "recorded" | "file";
  schemaVersion: number;
}>;

const PRINTS_SCHEMA_VERSION = 1;

/** The request as typed: the prompt before composition, and how many of the
 * recorded references were the person's own (the rest came from characters). */
export type TypedInput = Readonly<{ prompt: string; references: number }>;

const typedRowSchema = z.strictObject({
  prompt: printRecordSchema.shape.prompt,
  own_references: z.number().int().nonnegative(),
});

/** The typed request recorded with every print. */
export function printTyped(sql: SqlStorage, printId: string): TypedInput {
  const decoded = typedRowSchema.parse(
    sql
      .exec(
        "SELECT prompt, own_references FROM print_typed WHERE print_id=?",
        printId,
      )
      .one(),
  );
  return { prompt: decoded.prompt, references: decoded.own_references };
}

export function ensurePrintsIndexTables(sql: SqlStorage): void {
  ensurePromptCharacterTables(sql);
  sql.exec(
    `CREATE TABLE IF NOT EXISTS prints (
      print_id TEXT PRIMARY KEY,
      computer_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('image','video')),
      prompt TEXT NOT NULL,
      model TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      steps INTEGER,
      duration_seconds INTEGER,
      format TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      cost_milliunits INTEGER NOT NULL,
      actor_kind TEXT NOT NULL CHECK(actor_kind IN ('member','agent')),
      actor_id TEXT NOT NULL,
      derived_from TEXT,
      created_at INTEGER NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('recorded','file')),
      schema_version INTEGER NOT NULL
    ) STRICT`,
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS prints_computer_created ON prints(computer_id,created_at DESC,print_id DESC)",
  );
  sql.exec(
    `CREATE TABLE IF NOT EXISTS print_references (
      print_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      path TEXT NOT NULL,
      ref_print_id TEXT,
      PRIMARY KEY(print_id, position)
    ) STRICT`,
  );
  sql.exec(
    `CREATE TABLE IF NOT EXISTS print_typed (
      print_id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      own_references INTEGER NOT NULL
    ) STRICT`,
  );
  sql.exec(
    `CREATE TABLE IF NOT EXISTS print_files (
      computer_id TEXT NOT NULL,
      path TEXT NOT NULL,
      print_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('present','missing')),
      seen_at INTEGER NOT NULL,
      PRIMARY KEY(computer_id, path)
    ) STRICT`,
  );
}

type PrintRow = Readonly<{
  print_id: string;
  computer_id: string;
  kind: string;
  prompt: string;
  model: string;
  width: number | null;
  height: number | null;
  steps: number | null;
  duration_seconds: number | null;
  format: string;
  bytes: number;
  cost_milliunits: number;
  actor_kind: string;
  actor_id: string;
  derived_from: string | null;
  created_at: number;
  source: string;
  schema_version: number;
}>;

const printRowSchema = z.strictObject({
  print_id: printRecordSchema.shape.printId,
  computer_id: printRecordSchema.shape.computerId,
  kind: printRecordSchema.shape.kind,
  prompt: printRecordSchema.shape.prompt,
  model: printRecordSchema.shape.model,
  width: printRecordSchema.shape.width,
  height: printRecordSchema.shape.height,
  steps: printRecordSchema.shape.steps,
  duration_seconds: printRecordSchema.shape.durationSeconds,
  format: printRecordSchema.shape.format,
  bytes: printRecordSchema.shape.bytes,
  cost_milliunits: printRecordSchema.shape.costMilliunits,
  actor_kind: printRecordSchema.shape.actorKind,
  actor_id: printRecordSchema.shape.actorId,
  derived_from: printRecordSchema.shape.derivedFrom,
  created_at: printRecordSchema.shape.createdAt,
  source: printRecordSchema.shape.source,
  schema_version: printRecordSchema.shape.schemaVersion,
});

function printRecordOf(row: PrintRow): PrintRecord {
  const decoded = printRowSchema.parse(row);
  return {
    printId: decoded.print_id,
    computerId: decoded.computer_id,
    kind: decoded.kind,
    prompt: decoded.prompt,
    model: decoded.model,
    width: decoded.width,
    height: decoded.height,
    steps: decoded.steps,
    durationSeconds: decoded.duration_seconds,
    format: decoded.format,
    bytes: decoded.bytes,
    costMilliunits: decoded.cost_milliunits,
    actorKind: decoded.actor_kind,
    actorId: decoded.actor_id,
    derivedFrom: decoded.derived_from,
    createdAt: decoded.created_at,
    source: decoded.source,
    schemaVersion: decoded.schema_version,
  };
}

export function readPrint(
  sql: SqlStorage,
  printId: string,
): PrintRecord | null {
  const row = sql
    .exec<PrintRow>("SELECT * FROM prints WHERE print_id=?", printId)
    .toArray()[0];
  return row === undefined ? null : printRecordOf(row);
}

/** The one completed-print writer used by browser and Connector commands. */
export function recordCompletedPrint(
  sql: SqlStorage,
  input: Readonly<{
    printId: string;
    computerId: string;
    actor: Readonly<{ kind: "member" | "agent"; id: string }>;
    settings: MediaGenerationInput["settings"];
    result: CompleteGenerationRequest["result"];
    derivedFrom?: CompleteGenerationRequest["derivedFrom"];
    references?: CompleteGenerationRequest["references"];
    /** What the person asked for, before a style or saved characters were woven in. */
    typed: TypedInput;
    /** Name of the style block the prompt was composed with, if any. */
    style?: string | undefined;
    /** Names of the saved characters the prompt was composed with, in order. */
    characters?: readonly string[] | undefined;
  }>,
): PrintRecord {
  const { printId, computerId, settings } = input;
  const createdAt = Date.now();
  const kind = input.result.format === "mp4" ? "video" : "image";
  sql.exec(
    `INSERT INTO prints
        (print_id,computer_id,kind,prompt,model,width,height,steps,duration_seconds,
         format,bytes,cost_milliunits,actor_kind,actor_id,derived_from,created_at,
         source,schema_version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    printId,
    computerId,
    kind,
    settings.prompt,
    input.result.model,
    input.result.width,
    input.result.height,
    settings.steps ?? null,
    settings.durationSeconds ?? null,
    input.result.format,
    input.result.bytes,
    input.result.costMilliunits,
    input.actor.kind,
    input.actor.id,
    input.derivedFrom ?? null,
    createdAt,
    "recorded",
    PRINTS_SCHEMA_VERSION,
  );
  sql.exec(
    `INSERT INTO print_files (computer_id,path,print_id,state,seen_at) VALUES (?,?,?,'present',?)
       ON CONFLICT(computer_id,path) DO UPDATE SET print_id=excluded.print_id,state=excluded.state,seen_at=excluded.seen_at`,
    computerId,
    input.result.destination.path,
    printId,
    createdAt,
  );
  sql.exec(
    "INSERT INTO print_typed (print_id,prompt,own_references) VALUES (?,?,?)",
    printId,
    input.typed.prompt,
    input.typed.references,
  );
  if (input.style !== undefined) recordPrintStyle(sql, printId, input.style);
  const referencePaths = settings.references ?? [];
  const referencePrintIds = input.references ?? [];
  referencePaths.forEach((reference, position) => {
    sql.exec(
      "INSERT INTO print_references (print_id,position,path,ref_print_id) VALUES (?,?,?,?)",
      printId,
      position,
      reference.path,
      referencePrintIds[position] ?? null,
    );
  });
  recordPrintCharacters(sql, printId, input.characters ?? []);
  const print = readPrint(sql, printId);
  if (print === null)
    throw new Error("Prints index lost its own completed row");
  return print;
}

/** Read only this Installation's index on the admitted Computer. */
export function indexedOutput(
  sql: SqlStorage,
  computerId: string,
  printId: string,
  folder: string,
): Readonly<{ print: PrintRecord; path: string }> | null {
  const prefix = `${folder}/`;
  const row = sql
    .exec<PrintRow & { file_path: string }>(
      "SELECT p.*, f.path AS file_path FROM prints p JOIN print_files f ON f.print_id=p.print_id AND f.computer_id=p.computer_id WHERE p.computer_id=? AND p.print_id=? AND f.state='present' AND substr(f.path,1,length(?))=? AND instr(substr(f.path,length(?)+1),'/')=0",
      computerId,
      printId,
      prefix,
      prefix,
      prefix,
    )
    .toArray()[0];
  if (!row) return null;
  const { file_path, ...print } = row;
  return {
    print: printRecordOf(print),
    path: text(4096).parse(file_path),
  };
}
/** The reference images a print was generated from, in request order. */
export function printReferences(
  sql: SqlStorage,
  printId: string,
): readonly Readonly<{ path: string; printId: string | null }>[] {
  return sql
    .exec<{ path: string; ref_print_id: string | null }>(
      "SELECT path, ref_print_id FROM print_references WHERE print_id=? ORDER BY position",
      printId,
    )
    .toArray()
    .map((row) => ({
      path: text(4096).parse(row.path),
      printId: text(256).nullable().parse(row.ref_print_id),
    }));
}

/** Read one indexed output by its file path in this Installation's library. */
export function indexedOutputAtPath(
  sql: SqlStorage,
  computerId: string,
  filePath: string,
  folder: string,
): Readonly<{ print: PrintRecord; path: string }> | null {
  const prefix = `${folder}/`;
  const row = sql
    .exec<PrintRow & { file_path: string }>(
      "SELECT p.*, f.path AS file_path FROM prints p JOIN print_files f ON f.print_id=p.print_id AND f.computer_id=p.computer_id WHERE p.computer_id=? AND f.path=? AND f.state='present' AND substr(f.path,1,length(?))=? AND instr(substr(f.path,length(?)+1),'/')=0",
      computerId,
      filePath,
      prefix,
      prefix,
      prefix,
    )
    .toArray()[0];
  if (!row) return null;
  const { file_path, ...print } = row;
  return { print: printRecordOf(print), path: text(4096).parse(file_path) };
}

export function indexedOutputs(
  sql: SqlStorage,
  computerId: string,
  folder: string,
  after: Readonly<{ createdAt: number; printId: string }> | null,
  limit: number,
) {
  const prefix = `${folder}/`;
  const rows = sql
    .exec<PrintRow & { file_path: string }>(
      `SELECT p.*, f.path AS file_path FROM prints p JOIN print_files f ON f.print_id=p.print_id AND f.computer_id=p.computer_id WHERE p.computer_id=? AND f.state='present' AND substr(f.path,1,length(?))=? AND instr(substr(f.path,length(?)+1),'/')=0 AND (? IS NULL OR p.created_at<? OR (p.created_at=? AND p.print_id<?)) ORDER BY p.created_at DESC,p.print_id DESC LIMIT ?`,
      computerId,
      prefix,
      prefix,
      prefix,
      after?.createdAt ?? null,
      after?.createdAt ?? null,
      after?.createdAt ?? null,
      after?.printId ?? null,
      limit + 1,
    )
    .toArray();
  const items = rows.slice(0, limit).map(({ file_path, ...print }) => {
    const record = printRecordOf(print);
    return {
      print: record,
      path: text(4096).parse(file_path),
      references: printReferences(sql, record.printId),
      characters: printCharacters(sql, record.printId),
      typed: printTyped(sql, record.printId),
    };
  });
  const last = items.at(-1)?.print;
  return {
    items,
    next:
      rows.length > limit && last
        ? { createdAt: last.createdAt, printId: last.printId }
        : null,
  };
}
