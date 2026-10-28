import * as z from "zod";
import { printRecordSchema } from "./print-records.js";

const cursor = z.strictObject({
  createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  printId: printRecordSchema.shape.printId,
});
/** The reference images a print was generated from, in request order. */
const printReferencesSchema = z
  .array(
    z.strictObject({
      path: z.string().min(1).max(4096),
      /** The reference's own print id, or null for an upload or older file. */
      printId: printRecordSchema.shape.printId.nullable(),
    }),
  )
  .max(16);
export const outputItemSchema = z.strictObject({
  print: printRecordSchema,
  path: z.string().startsWith("/").min(2).max(4096),
  references: printReferencesSchema,
  /** The prompt as typed (with saved characters) and how many leading references
   * were the person's own. */
  typed: z.strictObject({
    prompt: printRecordSchema.shape.prompt,
    references: z.number().int().nonnegative().max(16),
  }),
  /** Saved characters the prompt used, by the name they had at the time. */
  characters: z.array(z.string().min(1).max(32)).max(16),
  /** Name of the saved style the prompt used at the time, or null for none. */
  style: z.string().min(1).max(64).nullable(),
});
export const outputAtPathInputSchema = z.strictObject({
  path: z.string().startsWith("/").min(2).max(4096),
});
export const outputPageInputSchema = z.strictObject({
  after: cursor.nullable().optional(),
  limit: z.number().int().min(1).max(24).default(24),
});
export const outputPageSchema = z.strictObject({
  items: z.array(outputItemSchema).max(24),
  next: cursor.nullable(),
});
