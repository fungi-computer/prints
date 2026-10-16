import {
  mediaGenerationReferenceSchema,
  mediaGenerationInputWireSchema,
  parseMediaGenerationInput,
  type MediaGenerationInput,
  type MediaGenerationReference,
} from "@fungi.computer/agar/media";
import * as Schema from "effect/Schema";

export const pendingGenerationSchema = Schema.Struct({
  reference: mediaGenerationReferenceSchema,
  input: mediaGenerationInputWireSchema,
});

export type PendingGenerationWire = Schema.Schema.Type<
  typeof pendingGenerationSchema
>;

/** Prints remembers the command; the Media owner retains its output and state. */
export type PendingGeneration = Readonly<{
  reference: MediaGenerationReference;
  input: MediaGenerationInput;
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
  };
}
