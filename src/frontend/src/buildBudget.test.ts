import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The entry chunk is what a first visit downloads before anything paints, so
 * anything that can wait for a route must not be inside it.
 *
 * `recharts` and its scale helpers are ~360 KB of that, and only two screens
 * draw a chart, so both are loaded through `lazyPage()` in `router.tsx`. This
 * check reads the build output rather than the source, because a single new
 * static import of a chart component anywhere in the eager graph would put the
 * dependency back and no source-level test would notice.
 *
 * It is skipped when there is no `dist/` — a checkout that has not run
 * `pnpm build` has nothing to measure — so CI must build before it tests.
 */
const dist = path.join(process.cwd(), "dist");
const entryHtml = path.join(dist, "index.html");
const built = existsSync(entryHtml);

describe("entry chunk", { skip: !built }, () => {
  const html = built ? readFileSync(entryHtml, "utf8") : "";
  const entryName = /<script[^>]+src="\/assets\/(index-[^"]+\.js)"/.exec(
    html,
  )?.[1];
  const entrySource = entryName
    ? readFileSync(path.join(dist, "assets", entryName), "latin1")
    : "";

  it("names the entry script it stamped into index.html", () => {
    expect(
      entryName,
      "index.html should reference an index-*.js entry",
    ).toBeTruthy();
  });

  it("keeps the chart library out of the entry chunk", () => {
    expect(entrySource).not.toMatch(/recharts/i);
    expect(entrySource).not.toMatch(/d3-scale/);
  });

  it("stays under the budget that lazy routes bought", () => {
    const kilobytes = Buffer.byteLength(entrySource, "latin1") / 1024;
    expect(
      kilobytes,
      `${entryName} is ${kilobytes.toFixed(1)} KB raw; the budget is 1400 KB`,
    ).toBeLessThan(1400);
  });

  it("keeps the chart pages in their own fetchable chunks", () => {
    // Evicting recharts by deleting the charts would pass the check above, so
    // this one proves the split instead: each lazy page still ships, as a file
    // the entry names rather than a copy of itself.
    const assets = readdirSync(path.join(dist, "assets")).filter((name) =>
      name.endsWith(".js"),
    );
    for (const page of ["Analytics", "ManageLink"]) {
      const chunk = assets.find(
        (name) => name.startsWith(`${page}-`) && name !== entryName,
      );
      if (!chunk) {
        throw new Error(`${page} should be built as its own chunk`);
      }
      expect(
        entrySource,
        `the entry should load ${chunk} dynamically`,
      ).toContain(chunk.replace(/\.js$/, ""));
    }
    const chartChunk = assets.some((name) =>
      /recharts/i.test(readFileSync(path.join(dist, "assets", name), "latin1")),
    );
    expect(chartChunk, "the chart library should still ship somewhere").toBe(
      true,
    );
  });
});
