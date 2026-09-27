/**
 * Regenerate the PWA icons from `public/icons/icon.svg`.
 *
 *   node scripts/make-icons.mjs      (run from src/frontend)
 *
 * Checked in on purpose: the manifest names concrete files, a manifest pointing
 * at a missing icon installs as a grey square, and doing this at build time
 * would need `sharp` — a root dev dependency, not one the frontend installs.
 *
 * The maskable variant is the same mark at 62% inside a full-bleed square, which
 * is what Android crops against: an icon with rounded corners baked in gets its
 * corners cut off, and a mark that fills the canvas loses its edges.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(here, "..", "public", "icons");

const svgSource = await readFile(join(iconsDir, "icon.svg"), "utf8");

/** Everything between the root <svg> tags, so it can be re-composed at any size. */
const artwork = svgSource
  .replace(/^[\s\S]*?<svg[^>]*>/u, "")
  .replace(/<\/svg>\s*$/u, "")
  .trim();

function canvas(inner, { fullBleed, size }) {
  const background = fullBleed
    ? '<rect width="512" height="512" fill="#8a3400" />'
    : "";
  const scale = fullBleed ? 0.62 : 1;
  const offset = ((1 - scale) / 2) * 512;
  const body = fullBleed
    ? `<g transform="translate(${offset.toFixed(1)} ${offset.toFixed(
        1,
      )}) scale(${scale})">${inner}</g>`
    : inner;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${background}${body}</svg>`;
}

async function png(inner, size, file, options = {}) {
  const buffer = await sharp(Buffer.from(canvas(inner, { size, ...options })))
    .png()
    .toBuffer();
  await writeFile(join(iconsDir, file), buffer);
  return file;
}

await mkdir(iconsDir, { recursive: true });

const written = [];
for (const size of [192, 512]) {
  written.push(await png(artwork, size, `icon-${size}.png`));
  written.push(
    await png(artwork, size, `icon-maskable-${size}.png`, { fullBleed: true }),
  );
}
written.push(await png(artwork, 96, "icon-96.png"));
written.push(await png(artwork, 180, "apple-touch-icon.png"));

console.log(written.map((name) => `public/icons/${name}`).join("\n"));
