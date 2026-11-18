import {
  mediaGenerationReferenceSchema,
  mediaGenerationInputWireSchema,
  parseMediaGenerationInput,
  type MediaGenerationInput,
  type MediaGenerationReference,
} from "@fungi.computer/agar/media";
import { appErrorCodes } from "@fungi.computer/agar/errors";
import * as Schema from "effect/Schema";
import { styleName } from "./prompt-styles.js";
import { characterName } from "./prompt-characters.js";

/** The request as the person typed it, before a style or saved characters were woven in. */
const typedSchema = Schema.Struct({
  prompt: Schema.NonEmptyString,
  /** How many of `input.settings.references` were the person's own. */
  references: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});

/** Why a generation stopped: the closed cause, and the plain sentence shown for it. */
const generationFailureSchema = Schema.Struct({
  reason: Schema.Literals([...appErrorCodes, "UNKNOWN"]),
  message: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(512))),
});
export type GenerationFailure = Schema.Schema.Type<
  typeof generationFailureSchema
>;

export const pendingGenerationSchema = Schema.Struct({
  reference: mediaGenerationReferenceSchema,
  input: mediaGenerationInputWireSchema,
  /** What the person asked for; `input.settings.prompt` is the composed result. */
  typed: typedSchema,
  /** The style block whose text leads `input.settings.prompt`, by name. */
  style: Schema.optional(styleName),
  /** Saved characters whose text and references the input was composed with. */
  characters: Schema.optional(Schema.Array(characterName)),
  /** Set once the run failed, so the reason survives a reload; cleared by a retry. */
  failure: Schema.optional(generationFailureSchema),
});

export type PendingGenerationWire = Schema.Schema.Type<
  typeof pendingGenerationSchema
>;

/** Prints remembers the command; the Media owner retains its output and state. */
export type PendingGeneration = Readonly<{
  reference: MediaGenerationReference;
  input: MediaGenerationInput;
  typed: Schema.Schema.Type<typeof typedSchema>;
  style?: string | undefined;
  characters?: readonly string[] | undefined;
  failure?: GenerationFailure | undefined;
}>;

export const rememberGenerationInputSchema = Schema.Struct({
  record: pendingGenerationSchema,
});
export const failGenerationInputSchema = Schema.Struct({
  reference: mediaGenerationReferenceSchema,
  failure: generationFailureSchema,
});
export const forgetGenerationInputSchema = Schema.Struct({
  reference: mediaGenerationReferenceSchema,
});
export const listGenerationsInputSchema = Schema.Struct({
  after: Schema.NullOr(Schema.String),
});

export function normalizePendingGeneration(
  record: PendingGenerationWire,
): PendingGeneration {
  return {
    reference: record.reference,
    input: parseMediaGenerationInput(record.input),
    typed: record.typed,
    style: record.style,
    characters: record.characters,
    failure: record.failure,
  };
}
