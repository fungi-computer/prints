import * as z from "zod";
import {
  CHARACTER_DESCRIPTION_LIMIT,
  CHARACTER_NAME_LIMIT,
  MAX_CHARACTERS,
  type PromptCharacter,
} from "../src/prompt-characters.js";

const characterRow = z.strictObject({
  id: z.number().int(),
  name: z.string().min(1).max(CHARACTER_NAME_LIMIT),
  description: z.string().max(CHARACTER_DESCRIPTION_LIMIT),
});
const referenceRow = z.strictObject({
  character_id: z.number().int(),
  path: z.string().min(1).max(4096),
});

/** Characters belong to the installation. A print keeps only the names used
 * when it was made, so deleting or renaming a character never touches a print. */
export function ensurePromptCharacterTables(sql: SqlStorage): void {
  sql.exec(
    "CREATE TABLE IF NOT EXISTS prompt_characters (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT NOT NULL) STRICT",
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS prompt_character_references (character_id INTEGER NOT NULL, position INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY(character_id,position)) STRICT",
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS print_characters (print_id TEXT NOT NULL, position INTEGER NOT NULL, character_name TEXT NOT NULL, PRIMARY KEY(print_id,position)) STRICT",
  );
}

/** Saved characters by name, each with its reference images in order. */
export function listPromptCharacters(sql: SqlStorage): PromptCharacter[] {
  const references = sql
    .exec(
      "SELECT character_id,path FROM prompt_character_references ORDER BY character_id,position",
    )
    .toArray()
    .map((row) => referenceRow.parse(row));
  return sql
    .exec("SELECT id,name,description FROM prompt_characters ORDER BY name")
    .toArray()
    .map((row) => {
      const character = characterRow.parse(row);
      return {
        ...character,
        references: references
          .filter((reference) => reference.character_id === character.id)
          .map(({ path }) => ({ path })),
      };
    });
}

export type SaveCharacterOutcome =
  | Readonly<{ kind: "saved" }>
  | Readonly<{ kind: "name-taken" }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "full" }>;

/** Create (no id) or rewrite/rename (id) one character; names are unique. */
export function savePromptCharacter(
  sql: SqlStorage,
  input: Readonly<{
    id?: number | undefined;
    name: string;
    description: string;
    references: readonly { path: string }[];
  }>,
): SaveCharacterOutcome {
  const sameName = sql
    .exec<{ id: number }>(
      "SELECT id FROM prompt_characters WHERE name=?",
      input.name,
    )
    .toArray()[0];
  if (sameName !== undefined && sameName.id !== input.id)
    return { kind: "name-taken" };
  let characterId = input.id;
  if (characterId === undefined) {
    const count = sql
      .exec<{ total: number }>(
        "SELECT COUNT(*) AS total FROM prompt_characters",
      )
      .one().total;
    if (count >= MAX_CHARACTERS) return { kind: "full" };
    sql.exec(
      "INSERT INTO prompt_characters(name,description) VALUES (?,?)",
      input.name,
      input.description,
    );
    characterId = sql
      .exec<{ id: number }>(
        "SELECT id FROM prompt_characters WHERE name=?",
        input.name,
      )
      .one().id;
  } else {
    const existing = sql
      .exec("SELECT id FROM prompt_characters WHERE id=?", characterId)
      .toArray();
    if (existing.length === 0) return { kind: "not-found" };
    sql.exec(
      "UPDATE prompt_characters SET name=?, description=? WHERE id=?",
      input.name,
      input.description,
      characterId,
    );
    sql.exec(
      "DELETE FROM prompt_character_references WHERE character_id=?",
      characterId,
    );
  }
  input.references.forEach((reference, position) => {
    sql.exec(
      "INSERT INTO prompt_character_references(character_id,position,path) VALUES (?,?,?)",
      characterId,
      position,
      reference.path,
    );
  });
  return { kind: "saved" };
}

export function deletePromptCharacter(sql: SqlStorage, id: number): void {
  sql.exec("DELETE FROM prompt_character_references WHERE character_id=?", id);
  sql.exec("DELETE FROM prompt_characters WHERE id=?", id);
}

/** Remember which characters made a print, in order; the first record wins. */
export function recordPrintCharacters(
  sql: SqlStorage,
  printId: string,
  names: readonly string[],
): void {
  names.forEach((name, position) => {
    sql.exec(
      "INSERT OR IGNORE INTO print_characters(print_id,position,character_name) VALUES (?,?,?)",
      printId,
      position,
      name,
    );
  });
}

/** The character names recorded for one print, in prompt order. */
export function printCharacters(sql: SqlStorage, printId: string): string[] {
  return sql
    .exec<{ character_name: string }>(
      "SELECT character_name FROM print_characters WHERE print_id=? ORDER BY position",
      printId,
    )
    .toArray()
    .map((row) =>
      z.string().min(1).max(CHARACTER_NAME_LIMIT).parse(row.character_name),
    );
}
