import { appBackend } from "@fungi.computer/agar/backend";
import type {
  CapabilityDirectory,
  MediaGenerationInput,
} from "@fungi.computer/agar";
import * as Schema from "effect/Schema";
import { composePrompt } from "./prompt-styles.js";
type MediaReference = NonNullable<
  MediaGenerationInput["settings"]["references"]
>[number];

export const MAX_CHARACTERS = 50;
export const CHARACTER_NAME_LIMIT = 32;
export const CHARACTER_DESCRIPTION_LIMIT = 500;
export const MAX_CHARACTER_REFERENCES = 8;
const MAX_SUGGESTIONS = 8;

/** A name the prompt can mention as `@name`: letters, digits, `_` and `-`. */
export const characterName = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(CHARACTER_NAME_LIMIT)),
  Schema.check(Schema.isPattern(/^[\p{L}\p{N}_-]+$/u)),
);
const characterDescription = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(CHARACTER_DESCRIPTION_LIMIT)),
);
const referencePath = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(4096)),
);
const characterReferences = Schema.Array(
  Schema.Struct({ path: referencePath }),
).pipe(Schema.check(Schema.isMaxLength(MAX_CHARACTER_REFERENCES)));
const computerId = Schema.NonEmptyString;

/** A saved character: a name, prompt text and reference images in the Prints folder. */
const characterSchema = Schema.Struct({
  id: Schema.Int,
  name: characterName,
  description: characterDescription,
  references: characterReferences,
});
export type PromptCharacter = Schema.Schema.Type<typeof characterSchema>;

/** Characters belong to this Prints installation; a Computer id only admits the call. */
export const promptCharacterRequestSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("list-characters"), computerId }),
  Schema.Struct({
    operation: Schema.Literal("save-character"),
    computerId,
    /** Omitted to create; present to rename or rewrite that character. */
    id: Schema.optional(Schema.Int),
    name: characterName,
    description: characterDescription,
    references: characterReferences,
  }),
  Schema.Struct({
    operation: Schema.Literal("delete-character"),
    computerId,
    id: Schema.Int,
  }),
]);
type PromptCharacterRequest = Schema.Schema.Type<
  typeof promptCharacterRequestSchema
>;
const promptCharactersSchema = Schema.Struct({
  characters: Schema.Array(characterSchema).pipe(
    Schema.check(Schema.isMaxLength(MAX_CHARACTERS)),
  ),
});

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const mention = /(?<![\p{L}\p{N}_@-])@([\p{L}\p{N}_-]+)/gu;

/** Name each `@mention` the prompt contains, in order of first appearance. */
export function mentionedNames(prompt: string): string[] {
  const names: string[] = [];
  for (const match of prompt.matchAll(mention)) {
    const name = match.at(1);
    if (name !== undefined && !names.some((seen) => sameName(seen, name)))
      names.push(name);
  }
  return names;
}

/**
 * Weave characters into a prompt. The first `@name` of a saved character
 * becomes `name (description)`; later ones stay the plain name. Unsaved
 * `@words` are left as typed. `characters` lists the saved characters used,
 * in order of first appearance.
 */
export function expandCharacters(
  prompt: string,
  saved: readonly PromptCharacter[],
) {
  const used: PromptCharacter[] = [];
  const expanded = prompt.replace(mention, (typed, name: string) => {
    const character = saved.find((entry) => sameName(entry.name, name));
    if (character === undefined) return typed;
    const first = !used.includes(character);
    if (first) used.push(character);
    return first && character.description.trim() !== ""
      ? `${character.name} (${character.description.trim()})`
      : character.name;
  });
  return { prompt: expanded, characters: used };
}

/**
 * How many characters a picked style and the expanded `@characters` add to
 * the typed prompt, so the counter shows the length the model receives.
 */
export function addedPromptLength(
  typed: string,
  styleText: string | undefined,
  saved: readonly PromptCharacter[],
): number {
  const prompt = typed.trim();
  return (
    composePrompt(styleText, expandCharacters(prompt, saved).prompt).length -
    prompt.length
  );
}

/** Put `@name` in front of the prompt for each name it does not yet mention. */
export function mentionNames(prompt: string, names: readonly string[]): string {
  const present = mentionedNames(prompt);
  const missing = names.filter(
    (name) => !present.some((seen) => sameName(seen, name)),
  );
  return missing.length === 0
    ? prompt
    : `${missing.map((name) => `@${name}`).join(" ")} ${prompt}`;
}

/**
 * The references plus each character's, in order, without repeating a file.
 * A character's references live on the selected Computer, so a bare path and
 * an explicit reference naming that Computer are the same file; a reference
 * on any other Computer stays distinct.
 */
function withCharacterReferences(
  references: readonly MediaReference[],
  characters: readonly PromptCharacter[],
  computerId: string | null,
): readonly MediaReference[] {
  const sameFile = (entry: MediaReference, path: string) =>
    entry.path === path &&
    (entry.computerId === undefined || entry.computerId === computerId);
  const merged: MediaReference[] = [...references];
  for (const character of characters)
    for (const reference of character.references)
      if (!merged.some((entry) => sameFile(entry, reference.path)))
        merged.push({ path: reference.path });
  return merged;
}

export type CharacterPlan =
  | Readonly<{
      kind: "ready";
      prompt: string;
      references: NonNullable<MediaGenerationInput["settings"]["references"]>;
      characters: readonly PromptCharacter[];
    }>
  | Readonly<{ kind: "refused"; message: string }>;

/**
 * Expand a prompt's characters and count their references against the model.
 * `names` are characters picked outside the prompt text (the agent tool).
 * `computerId` is the selected Computer, whose explicit references dedupe
 * against character paths; null when none is selected.
 */
export function planCharacters(
  input: Readonly<{
    prompt: string;
    names?: readonly string[] | undefined;
    saved: readonly PromptCharacter[];
    references: NonNullable<MediaGenerationInput["settings"]["references"]>;
    computerId: string | null;
    model: Readonly<{ label: string; maxReferences: number }> | undefined;
  }>,
): CharacterPlan {
  const expansion = expandCharacters(
    mentionNames(input.prompt, input.names ?? []),
    input.saved,
  );
  const references = withCharacterReferences(
    input.references,
    expansion.characters,
    input.computerId,
  );
  const added = references.length - input.references.length;
  if (
    input.model !== undefined &&
    added > 0 &&
    references.length > input.model.maxReferences
  ) {
    const who = expansion.characters.map((entry) => entry.name).join(", ");
    return {
      kind: "refused",
      message:
        input.model.maxReferences === 0
          ? `${input.model.label} does not take reference images, so it cannot use ${who}.`
          : `${who} add ${String(added)} reference ${added === 1 ? "image" : "images"} to your ${String(input.references.length)}; ${input.model.label} accepts at most ${String(input.model.maxReferences)}.`,
    };
  }
  return {
    kind: "ready",
    prompt: expansion.prompt,
    references,
    characters: expansion.characters,
  };
}

/** The `@word` being typed at the caret, and where it starts. */
export function mentionAt(
  draft: string,
  caret: number,
): Readonly<{ start: number; query: string }> | null {
  const found = /(?<![\p{L}\p{N}_@-])@([\p{L}\p{N}_-]*)$/u.exec(
    draft.slice(0, caret),
  );
  return found === null
    ? null
    : { start: found.index, query: found.at(1) ?? "" };
}

/** Saved characters whose name starts with, then contains, what was typed. */
export function suggestCharacters(
  saved: readonly PromptCharacter[],
  query: string,
): readonly PromptCharacter[] {
  const wanted = query.toLowerCase();
  const names = (entry: PromptCharacter) => entry.name.toLowerCase();
  return [
    ...saved.filter((entry) => names(entry).startsWith(wanted)),
    ...saved.filter(
      (entry) =>
        !names(entry).startsWith(wanted) && names(entry).includes(wanted),
    ),
  ].slice(0, MAX_SUGGESTIONS);
}

const asking = (capabilities: CapabilityDirectory) =>
  capabilities.require(appBackend);
const body = (request: PromptCharacterRequest): string =>
  JSON.stringify(request);
const decodeCharacters = Schema.decodeUnknownSync(promptCharactersSchema);

export async function listCharacters(
  capabilities: CapabilityDirectory,
  id: string,
) {
  return decodeCharacters(
    await asking(capabilities).request(
      body({ operation: "list-characters", computerId: id }),
    ),
  );
}
export async function saveCharacter(
  capabilities: CapabilityDirectory,
  id: string,
  character: Readonly<{
    id?: number | undefined;
    name: string;
    description: string;
    references: readonly { path: string }[];
  }>,
) {
  return decodeCharacters(
    await asking(capabilities).request(
      body({
        operation: "save-character",
        computerId: id,
        id: character.id,
        name: character.name,
        description: character.description,
        references: character.references,
      }),
    ),
  );
}
export async function deleteCharacter(
  capabilities: CapabilityDirectory,
  id: string,
  characterId: number,
) {
  return decodeCharacters(
    await asking(capabilities).request(
      body({
        operation: "delete-character",
        computerId: id,
        id: characterId,
      }),
    ),
  );
}
