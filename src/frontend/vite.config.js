import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import environment from "vite-plugin-environment";
import {
  contentSecurityPolicy,
  securityHeaders,
} from "./src/lib/security/contentSecurityPolicy";

const ii_url =
  process.env.DFX_NETWORK === "local"
    ? `http://uqzsh-gqaaa-aaaaq-qaada-cai.localhost:8081/authorize`
    : `https://id.ai/authorize`;

process.env.II_URL = process.env.II_URL || ii_url;

/**
 * Stamp the Content-Security-Policy into the built `index.html`.
 *
 * Build only, for two reasons. A dev server needs an inline script for the React
 * refresh preamble and a WebSocket for HMR, so a policy strict enough to be worth
 * having would break the dev server; and a policy applied in both modes teaches
 * nobody anything, because the one that ships is the built one.
 */
function securityPolicy(supabaseUrl) {
  let root = process.cwd();
  let outDir = "dist";
  return {
    name: "studyforge-security-policy",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: contentSecurityPolicy({ supabaseUrl }),
          },
          injectTo: "head-prepend",
        },
      ];
    },
    closeBundle() {
      // The directives a `<meta>` cannot carry travel as a header file, written
      // next to the bundle from the same module so the two policies cannot
      // drift apart. Not committed: a copy in the repo would go stale the
      // moment a new outbound origin appeared.
      //
      // Vercel reads neither this file nor the `<meta>` (it reads vercel.json,
      // synced by `pnpm security:headers`), and every path under dist is
      // served — so the artifact is opt-in (EMIT_HEADERS=1) for hosts that
      // actually consume it (Cloudflare Pages, Netlify) and is not published
      // on the Vercel deployment.
      if (process.env.EMIT_HEADERS === "1") {
        writeFileSync(
          join(root, outDir, "_headers"),
          securityHeaders({ supabaseUrl }),
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // `.env.local` is read in every mode, so a build on this machine gets the real
  // project origin in `connect-src`; CI with no file falls back to the wildcard.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // A production bundle must never carry the localStorage mock backend: every
  // account would live in the visitor's browser. Refuse loudly at build time
  // rather than shipping a silently broken deployment.
  if (
    mode === "production" &&
    (env.VITE_DATA_BACKEND === "mock" || env.VITE_USE_MOCK === "true")
  ) {
    throw new Error(
      "Refusing to build a production bundle on the mock backend (VITE_DATA_BACKEND/VITE_USE_MOCK).",
    );
  }
  return {
  logLevel: "error",
  build: {
    emptyOutDir: true,
    sourcemap: false,
    // Minified: the unminified bundle is ~3.5 MB of JavaScript on a phone
    // connection, and nothing in the app depends on readable function names at
    // runtime. `dist/` is still debuggable — the stack frames just carry the
    // bundler's identifiers.
    minify: "esbuild",
  },
  // Production only — dev needs its console. Drops the three console.* calls
  // that would otherwise ship in the bundle (audit: debug mode off in prod).
  esbuild:
    mode === "production" ? { drop: ["console", "debugger"] } : undefined,
  css: {
    postcss: "./postcss.config.js",
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4943",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    // Explicit allowlist, not prefix sweeps: `environment("all", { prefix })`
    // copies every matching variable from the shell into the client bundle,
    // which is how a stray CANISTER_*/DFX_* secret would be published. The
    // template runtime reads only these; nothing under src/ consumes more.
    // Object form = defaults for absent vars: a deployment that sets them
    // still forwards them; one that doesn't is not forced to define them.
    environment({
      CANISTER_ID_BACKEND: "",
      CANISTER_ID_FRONTEND: "",
      CANISTER_ID_INTERNET_IDENTITY: "",
      DFX_NETWORK: "",
    }),
    environment(["II_URL"]),
    react(),
    securityPolicy(env.VITE_SUPABASE_URL),
  ],
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
  };
});
