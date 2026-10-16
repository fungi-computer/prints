import { defineConfig } from "vitest/config";

const source = (path: string): string =>
  new URL(path, import.meta.url).pathname;

/** Prints' backend Durable Object runs on real `cloudflare:workers`; this
 * leg stands in only that specifier so `backend/index.ts` can be unit
 * tested with a real in-memory SQLite `ctx.storage.sql`, never Miniflare. */
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": source("./test/cloudflare-workers.fixture.ts"),
    },
  },
  test: {
    root: source("."),
    environment: "node",
    include: ["test/*.test.{ts,mjs}"],
  },
});
