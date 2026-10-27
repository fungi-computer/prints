import {
  mediaGenerationReferenceSchema,
  mediaGenerationInputWireSchema,
  parseMediaGenerationInput,
  type MediaGenerationInput,
  type MediaGenerationReference,
} from "@fungi.computer/agar/media";
import * as Schema from "effect/Schema";
import { styleName } from "./prompt-styles.js";
import { characterName } from "./prompt-characters.js";

/** The request as the person typed it, before a style or saved characters were woven in. */
const typedSchema = Schema.Struct({
  prompt: Schema.NonEmptyString,
  /** How many of `input.settings.references` were the person's own. */
  references: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});

export const pendingGenerationSchema = Schema.Struct({
  reference: mediaGenerationReferenceSchema,
  input: mediaGenerationInputWireSchema,
  /** What the person asked for; `input.settings.prompt` is the composed result. */
  typed: typedSchema,
  /** The style block whose text leads `input.settings.prompt`, by name. */
  style: Schema.optional(styleName),
  /** Saved characters whose text and references the input was composed with. */
  characters: Schema.optional(Schema.Array(characterName)),
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
}>;

export const mediaRecoveryRequestSchema = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("remember-generation"),
    record: pendingGenerationSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal("forget-generation"),
    reference: mediaGenerationReferenceSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal("list-generations"),
    after: Schema.NullOr(Schema.String),
  }),
]);

export function normalizePendingGeneration(
  record: PendingGenerationWire,
): PendingGeneration {
  return {
    reference: record.reference,
    input: parseMediaGenerationInput(record.input),
    typed: record.typed,
    style: record.style,
    characters: record.characters,
  };
}
