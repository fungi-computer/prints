import * as z from "zod";
import { printRecordSchema } from "./print-records.js";

const cursor = z.strictObject({
  createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  printId: printRecordSchema.shape.printId,
});
export const outputPageInputSchema = z.strictObject({
  after: cursor.nullable().optional(),
  limit: z.number().int().min(1).max(24).default(24),
});
export const outputPageSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        print: printRecordSchema,
        path: z.string().startsWith("/").min(2).max(4096),
      }),
    )
    .max(24),
  next: cursor.nullable(),
});
