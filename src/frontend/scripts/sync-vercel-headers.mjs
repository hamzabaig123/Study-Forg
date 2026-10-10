/**
 * Write the header policy into the host's own config.
 *
 * Vercel reads neither the `<meta>` nor `dist/_headers`, so a policy that only
 * lives in a tag is the policy that ships: no `frame-ancestors`, no HSTS from
 * this app, no framing refusal in the header a browser can enforce. This script
 * calls `securityHeaders()` — the same function the build stamps the `<meta>`
 * from — and writes every path block it emits into the `headers` array of both
 * `vercel.json` files: the `/*` security rule first, then the per-path
 * `Cache-Control` rules (`/assets/*` immutable, `/index.html` and `/sw.js`
 * revalidated) so the hashed-bundle caching Cloudflare Pages and Netlify get
 * from `dist/_headers` also reaches the host this app actually deploys to.
 *
 * It generates the policy rather than reading the build artifact, because the
 * artifact is opt-in (`EMIT_HEADERS=1`): Vercel serves every path under `dist`,
 * so a file nobody reads there is a file the public can download.
 *
 * Run it after editing `src/lib/security/contentSecurityPolicy.ts`:
 *
 *   pnpm security:headers
 *
 * `contentSecurityPolicy.test.ts` fails if the two disagree, so forgetting this
 * step is a red test rather than a silently unprotected deploy.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnv } from "vite";

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(frontendRoot, "..", "..");

/**
 * Every path block of a `_headers`-shaped file, in order.
 *
 * Returns `[{ source, headers }]` where `source` is the block's path pattern
 * (e.g. `/*`, `/assets/*`, `/sw.js`) and `headers` are its name/value pairs.
 * The first entry is the `/*` security block; the rest are the per-path
 * `Cache-Control` rules `securityHeaders()` also emits. Reading them all — not
 * just `/*` — is the whole point: the immutable-asset caching Cloudflare Pages
 * and Netlify get from `dist/_headers` has to reach `vercel.json` too, or the
 * host this app actually deploys to serves hashed files with `max-age=0`.
 */
function headerBlocks(text) {
  const lines = text
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"));
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("/")) {
      current = { source: line.trim(), headers: [] };
      blocks.push(current);
      continue;
    }
    const match = line.match(/^ {2}([A-Za-z][A-Za-z-]*): (.+)$/);
    if (!match) throw new Error(`unparseable header line: ${line}`);
    if (!current) throw new Error("a header line appears before any path");
    current.headers.push({ key: match[1], value: match[2] });
  }
  if (blocks.length === 0)
    throw new Error("the generated policy has no blocks");
  const global = blocks.find((block) => block.source === "/*");
  if (!global || global.headers.length === 0) {
    throw new Error("the /* block of the policy is missing or empty");
  }
  return blocks;
}

/**
 * Translate a `_headers` path pattern into a Vercel `source`.
 *
 * Cloudflare/Netlify match `/assets/*` as a glob; Vercel matches path-to-regexp,
 * where `/(.*)` is the equivalent regex the existing security rule already uses.
 * A pattern with no `*` (`/sw.js`, `/index.html`) is a literal path in both.
 */
function vercelSource(pattern) {
  return pattern.replace(/\*/g, "(.*)");
}

const policyModule = await import(
  pathToFileURL(
    join(frontendRoot, "src", "lib", "security", "contentSecurityPolicy.ts"),
  ).href
);
// The same env the build resolves, so the origin the header names is the origin
// the `<meta>` names: two enforced policies, and the stricter one wins.
const env = loadEnv("production", frontendRoot, "VITE_");
const blocks = headerBlocks(
  policyModule.securityHeaders({ supabaseUrl: env.VITE_SUPABASE_URL }),
);

for (const target of [
  join(repoRoot, "vercel.json"),
  join(frontendRoot, "vercel.json"),
]) {
  const config = JSON.parse(readFileSync(target, "utf8"));
  // Same rule Vercel matches a rewritten SPA deep link against: `source` is the
  // request path, so `/(.*)` covers `/dashboard` and `/.` and every route. That
  // security block stays first (the test reads `headers[0]`); the per-path
  // Cache-Control rules follow, translated from the generated globs.
  config.headers = blocks.map((block) => ({
    source: vercelSource(block.source),
    headers: block.headers,
  }));
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  console.log(
    `${target}: ${config.headers.length} rules ` +
      `(${config.headers.map((rule) => rule.source).join(", ")})`,
  );
}
