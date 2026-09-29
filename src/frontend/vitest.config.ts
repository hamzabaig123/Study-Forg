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
    /**
     * The suite always runs against the canister seam, whatever this machine's
     * `.env.local` says.
     *
     * Vite loads `.env.local` into `import.meta.env` for every mode, including
     * `test`, and all four variables decide which backend `useBackend` builds —
     * the two flags directly, and the Supabase pair as the third branch of
     * `selectDataBackend()`. Left to the file, either half of it moves the whole
     * suite: a `VITE_DATA_BACKEND=mock` written for the dev server swaps the
     * localStorage object in front of every page test, and a *complete* project
     * URL and publishable key (which is what a real integration ends up with)
     * select the Supabase adapter instead, so every page test then dies on
     * "There is no Supabase session". Both look like broken pages, not a
     * mis-set file. Pinning them keeps the seam the tests inject actors into the
     * one thing the suite ever runs against; the modes are covered by
     * tests that pin `@/lib/authMode` themselves.
     *
     * The Turnstile site key is pinned for the same reason one level down: a key
     * in `.env.local` would make `captchaConfigured()` true in every auth page
     * test, and each of those forms would then wait on a widget jsdom cannot
     * solve. A test that wants the captcha shape stubs `@/lib/turnstile`.
     */
    env: {
      VITE_DATA_BACKEND: "",
      VITE_USE_MOCK: "",
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
      VITE_TURNSTILE_SITE_KEY: "",
    },
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
