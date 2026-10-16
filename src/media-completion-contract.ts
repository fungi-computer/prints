import * as Schema from "effect/Schema";
import { mediaGenerationReferenceSchema } from "@fungi.computer/agar/media";

const text = (maximum: number) =>
  Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(maximum)),
  );
const safeInteger = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(
    Schema.makeFilter(Number.isSafeInteger, {
      message: "Expected a safe integer",
    }),
  ),
);
const positiveInteger = safeInteger.pipe(Schema.check(Schema.isGreaterThan(0)));
const nonNegativeInteger = safeInteger.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
);

/** Schema for the App-reported MediaGenerationResult at the Prints backend
 * JSON boundary. Agar exports the type, but not a result decoder. */
const completedResultSchema = Schema.Struct({
  bytes: positiveInteger,
  costMilliunits: nonNegativeInteger,
  destination: Schema.Struct({ computerId: text(256), path: text(4_096) }),
  format: Schema.Literals(["png", "jpeg", "gif", "webp", "mp4"]),
  height: positiveInteger,
  model: text(256),
  width: positiveInteger,
});

export const completeGenerationRequestSchema = Schema.Struct({
  operation: Schema.Literal("complete-generation"),
  reference: mediaGenerationReferenceSchema,
  result: completedResultSchema,
  /** The parent print this is a variation of; Prints' own lineage, never a
   * Hub or provider fact. */
  derivedFrom: Schema.optional(text(256)),
  /** Print ids for `input.settings.references`, aligned by position. A
   * position with no known print (an upload, or a file from before the
   * index existed) is `null`. */
  references: Schema.optional(Schema.Array(Schema.NullOr(text(256)))),
});
export type CompleteGenerationRequest = Schema.Schema.Type<
  typeof completeGenerationRequestSchema
>;
