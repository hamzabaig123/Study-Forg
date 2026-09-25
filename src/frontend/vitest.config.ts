import { fileURLToPath, URL } from "url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the frontend suite.
 *
 * The `@` alias mirrors `vite.config.js` so tests import production modules by
 * the same specifier the app does. The DOM environment is supplied by the
 * `test` script (`--environment jsdom`), not here, so a focused run through
 * `pnpm --dir app/src/frontend test <file>` behaves identically to the gate.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "declarations",
        replacement: fileURLToPath(new URL("../declarations", import.meta.url)),
      },
      {
        find: "@",
        replacement: fileURLToPath(new URL("./src", import.meta.url)),
      },
    ],
    dedupe: ["@icp-sdk/core"],
  },
  test: {
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    // Mounting a page costs several seconds on a slow disk (Radix portals,
    // react-query, the router), which pushes interaction-heavy tests past
    // Vitest's 5s default without anything actually being wrong.
    testTimeout: 20_000,
    // The container's CPU count can make Vitest's default fork pool compute a
    // min/max thread range that conflicts. A single fork is deterministic and
    // ample for a component suite.
    pool: "forks",
    poolOptions: {
      forks: { minForks: 1, maxForks: 1 },
    },
  },
});
