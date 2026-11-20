import { defineConfig, mergeConfig } from "vitest/config";
import { scaledBudgetMs } from "../../tooling/repository/scripts/proof-budget.mjs";
import viteConfig from "./vite.config.mjs";

// The gallery and viewer laws render whole panes. The default 5 s is fine on an
// idle host and misses on a loaded one: the base stretches with host load, up to
// four times.
export default mergeConfig(
  viteConfig,
  defineConfig({ test: { testTimeout: scaledBudgetMs(10_000) } }),
);
