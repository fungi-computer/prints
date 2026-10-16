import { defineAppGill, type AppBackendGill } from "@fungi.computer/agar/gills";
import { relativeTime } from "@fungi.computer/gills/presentation";
import { methodRefusalSchema } from "./method-contracts.js";
import { outputPageInputSchema, outputPageSchema } from "./output-page.js";

/** Saved output records only; opening the App validates the live file. */
export const recentOutputsGill = defineAppGill({
  id: "recent-outputs",
  title: "Recent Outputs",
  source: "listOutputs",
  limit: 24,
  sizes: ["M", "L"],
  params: [
    { key: "computer", label: "Computer", kind: "computer", required: true },
  ],
  input: ({ limit, after }): ReturnType<AppBackendGill["input"]> => {
    const cursor: unknown = after === undefined ? undefined : JSON.parse(after);
    const input = outputPageInputSchema.parse(
      cursor === undefined ? { limit } : { limit, after: cursor },
    );
    return input.after === undefined
      ? { limit: input.limit }
      : { limit: input.limit, after: input.after };
  },
  rows: (output) => {
    const identity = { viewId: "recent-outputs", title: "Recent Outputs" };
    const refused = methodRefusalSchema.safeParse(output);
    if (refused.success)
      return refused.data.error === "not_granted"
        ? {
            ...identity,
            state: "error",
            rows: [],
            error: "Choose a Computer and allow Prints to list its files.",
            recovery: { kind: "configure", param: "computer" },
          }
        : {
            ...identity,
            state: "error",
            rows: [],
            error:
              refused.data.error === "library_unavailable"
                ? "Choose a library folder in Prints to see recorded outputs."
                : "Recorded outputs couldn't be read. Open Prints to check the library and access.",
            recovery: { kind: "open" },
          };
    const page = outputPageSchema.parse(output);
    if (page.items.length === 0)
      return { ...identity, state: "empty", rows: [] };
    const rows = page.items.map(({ print, path }) => {
      const name = path.split("/").at(-1);
      return {
        id: print.printId,
        title:
          name === undefined || name.length === 0 ? "Recorded output" : name,
        detail: `${print.kind === "image" ? "Image" : "Video"}${print.width === null || print.height === null ? "" : ` · ${String(print.width)} × ${String(print.height)}`} · ${relativeTime(print.createdAt)}`,
        open: { params: [{ key: "print", value: print.printId }] },
      };
    });
    return page.next === null
      ? { ...identity, state: "full", rows }
      : { ...identity, state: "full", rows, next: JSON.stringify(page.next) };
  },
});
