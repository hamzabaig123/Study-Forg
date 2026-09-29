/**
 * Write the header policy into the host's own config.
 *
 * Vercel reads neither the `<meta>` nor `dist/_headers`, so a policy that only
 * lives in a tag is the policy that ships: no `frame-ancestors`, no HSTS from
 * this app, no framing refusal in the header a browser can enforce. This script
 * calls `securityHeaders()` — the same function the build stamps the `<meta>`
 * from — and writes its `/*` block verbatim into the `headers` array of both
 * `vercel.json` files.
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

/** The `/*` block of a `_headers`-shaped file, as name/value pairs. */
function globalHeaders(text) {
  const lines = text
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"));
  const start = lines.indexOf("/*");
  if (start === -1) throw new Error("the generated policy has no /* block");
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("/")) break;
    const match = line.match(/^ {2}([A-Za-z][A-Za-z-]*): (.+)$/);
    if (!match) throw new Error(`unparseable header line: ${line}`);
    out.push({ key: match[1], value: match[2] });
  }
  if (out.length === 0) throw new Error("the /* block of the policy is empty");
  return out;
}

const policyModule = await import(
  pathToFileURL(
    join(frontendRoot, "src", "lib", "security", "contentSecurityPolicy.ts"),
  ).href
);
// The same env the build resolves, so the origin the header names is the origin
// the `<meta>` names: two enforced policies, and the stricter one wins.
const env = loadEnv("production", frontendRoot, "VITE_");
const headers = globalHeaders(
  policyModule.securityHeaders({ supabaseUrl: env.VITE_SUPABASE_URL }),
);

for (const target of [
  join(repoRoot, "vercel.json"),
  join(frontendRoot, "vercel.json"),
]) {
  const config = JSON.parse(readFileSync(target, "utf8"));
  // Same rule Vercel matches a rewritten SPA deep link against: `source` is the
  // request path, so `/(.*)` covers `/dashboard` and `/.` and every route.
  config.headers = [{ source: "/(.*)", headers }];
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`${target}: ${headers.length} headers`);
}
