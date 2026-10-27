import { MAX_MEDIA_PROMPT_LENGTH } from "@fungi.computer/darkroom/browser";
import * as z from "zod";

const text = (maximum: number) => z.string().min(1).max(maximum);
const safeInteger = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const positiveInteger = safeInteger.positive();
const nonNegativeInteger = safeInteger.nonnegative();

/** Shared stored output contract, usable by the backend and gallery receiver. */
export const printRecordSchema = z.strictObject({
  printId: text(256),
  computerId: text(256),
  kind: z.enum(["image", "video"]),
  prompt: text(MAX_MEDIA_PROMPT_LENGTH),
  model: text(256),
  width: positiveInteger.nullable(),
  height: positiveInteger.nullable(),
  steps: nonNegativeInteger.nullable(),
  durationSeconds: nonNegativeInteger.nullable(),
  format: text(32),
  bytes: positiveInteger,
  costMilliunits: nonNegativeInteger,
  actorKind: z.enum(["member", "agent"]),
  actorId: text(256),
  derivedFrom: text(256).nullable(),
  createdAt: nonNegativeInteger,
  source: z.enum(["recorded", "file"]),
  schemaVersion: positiveInteger,
});
