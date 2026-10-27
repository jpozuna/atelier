// Vitest config for the timing script only (`npm test` never picks it up: its include is src and evals).
//   npx vitest run --config scripts/perf/vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
      "server-only": fileURLToPath(new URL("../../node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["scripts/perf/**/*.perf.ts"],
    disableConsoleIntercept: true,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
