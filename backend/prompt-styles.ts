import * as z from "zod";
import {
  BUILT_IN_STYLES,
  MAX_STYLES,
  STYLE_NAME_LIMIT,
  STYLE_TEXT_LIMIT,
  type PromptStyle,
} from "../src/prompt-styles.js";

const styleRow = z.strictObject({
  id: z.number().int(),
  name: z.string().min(1).max(STYLE_NAME_LIMIT),
  text: z.string().min(1).max(STYLE_TEXT_LIMIT),
});
const isBuiltInName = (name: string) =>
  BUILT_IN_STYLES.some((style) => style.name === name);

/** Styles belong to the installation. A print keeps only the style's name at
 * the time it was made, so deleting or renaming a style never touches a print. */
export function ensurePromptStyleTables(sql: SqlStorage): void {
  sql.exec(
    "CREATE TABLE IF NOT EXISTS prompt_styles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, text TEXT NOT NULL) STRICT",
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS print_styles (print_id TEXT PRIMARY KEY, style_name TEXT NOT NULL) STRICT",
  );
}

/** Built-in starters first, then the saved styles by name. */
export function listPromptStyles(sql: SqlStorage): PromptStyle[] {
  return [
    ...BUILT_IN_STYLES,
    ...sql
      .exec(
        "SELECT id,name,text FROM prompt_styles ORDER BY name COLLATE NOCASE",
      )
      .toArray()
      .map((row) => ({ ...styleRow.parse(row), builtIn: false })),
  ];
}

export function promptStyleNamed(
  sql: SqlStorage,
  name: string,
): PromptStyle | null {
  const builtIn = BUILT_IN_STYLES.find((style) => style.name === name);
  if (builtIn !== undefined) return builtIn;
  const row = sql
    .exec("SELECT id,name,text FROM prompt_styles WHERE name=?", name)
    .toArray()[0];
  return row === undefined ? null : { ...styleRow.parse(row), builtIn: false };
}

export type SaveStyleOutcome =
  | Readonly<{ kind: "saved" }>
  | Readonly<{ kind: "name-taken" }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "full" }>;

/** Create (no id) or rewrite/rename (id) one style; names are unique. */
export function savePromptStyle(
  sql: SqlStorage,
  input: Readonly<{ id?: number | undefined; name: string; text: string }>,
): SaveStyleOutcome {
  if (isBuiltInName(input.name)) return { kind: "name-taken" };
  if (input.id !== undefined && input.id < 0) return { kind: "not-found" };
  const sameName = sql
    .exec<{ id: number }>(
      "SELECT id FROM prompt_styles WHERE name=?",
      input.name,
    )
    .toArray()[0];
  if (sameName !== undefined && sameName.id !== input.id)
    return { kind: "name-taken" };
  if (input.id === undefined) {
    const count = sql
      .exec<{ total: number }>("SELECT COUNT(*) AS total FROM prompt_styles")
      .one().total;
    if (count >= MAX_STYLES) return { kind: "full" };
    sql.exec(
      "INSERT INTO prompt_styles(name,text) VALUES (?,?)",
      input.name,
      input.text,
    );
    return { kind: "saved" };
  }
  const existing = sql
    .exec("SELECT id FROM prompt_styles WHERE id=?", input.id)
    .toArray();
  if (existing.length === 0) return { kind: "not-found" };
  sql.exec(
    "UPDATE prompt_styles SET name=?, text=? WHERE id=?",
    input.name,
    input.text,
    input.id,
  );
  return { kind: "saved" };
}

export function deletePromptStyle(sql: SqlStorage, id: number): void {
  sql.exec("DELETE FROM prompt_styles WHERE id=?", id);
}

/** Remember which style made a print; the first record wins. */
export function recordPrintStyle(
  sql: SqlStorage,
  printId: string,
  styleName: string,
): void {
  sql.exec(
    "INSERT OR IGNORE INTO print_styles(print_id,style_name) VALUES (?,?)",
    printId,
    styleName,
  );
}

/** The style name recorded for the print saved at one path on one Computer. */
export function printStyleAt(
  sql: SqlStorage,
  computerId: string,
  path: string,
): string | null {
  const row = sql
    .exec<{ style_name: string }>(
      "SELECT s.style_name FROM print_files f JOIN print_styles s ON s.print_id=f.print_id WHERE f.computer_id=? AND f.path=?",
      computerId,
      path,
    )
    .toArray()[0];
  return row?.style_name ?? null;
}
