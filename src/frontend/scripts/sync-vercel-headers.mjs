/**
 * Copy the generated header policy into the host's own config.
 *
 * Vercel does not read `dist/_headers`, so a policy that only lives in a `<meta>`
 * is the policy that ships: no `frame-ancestors`, no HSTS from this app, no
 * framing refusal in the header a browser can enforce. This script takes the
 * `/*` block the build just wrote and writes it, verbatim, into the `headers`
 * array of both `vercel.json` files.
 *
 * Run it after editing `src/lib/security/contentSecurityPolicy.ts`:
 *
 *   pnpm build && pnpm security:headers
 *
 * `contentSecurityPolicy.test.ts` fails if the two disagree, so forgetting this
 * step is a red test rather than a silently unprotected deploy.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(frontendRoot, "..", "..");

/** The `/*` block of a `_headers` file, as an ordered list of name/value pairs. */
function globalHeaders(text) {
  const lines = text
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"));
  const start = lines.indexOf("/*");
  if (start === -1)
    throw new Error("no /* block in dist/_headers — run pnpm build");
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("/")) break;
    const match = line.match(/^ {2}([A-Za-z][A-Za-z-]*): (.+)$/);
    if (!match) throw new Error(`unparseable header line: ${line}`);
    out.push({ key: match[1], value: match[2] });
  }
  if (out.length === 0)
    throw new Error("the /* block in dist/_headers is empty");
  return out;
}

const policy = readFileSync(join(frontendRoot, "dist", "_headers"), "utf8");
const headers = globalHeaders(policy);

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
