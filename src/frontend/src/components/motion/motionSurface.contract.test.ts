import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The contract this app's motion layer runs on, asserted against the repository
 * rather than by eye. Each check catches a failure mode that produces no build
 * error and no console message:
 *
 * 1. `LazyMotion ... strict` refuses `motion.*` components at runtime — an entry
 *    that imported them would throw in the browser, not in `tsc`.
 * 2. An animation effect with no call site is dead code that still costs bundle
 *    weight, which is the trap every vendored Magic UI component walks into.
 * 3. A decorative animation missing from the `prefers-reduced-motion` block
 *    promises the user less motion and then delivers it anyway.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx?|jsx?)$/.test(entry) ? [full] : [];
  });
}

const ALL = sourceFiles(SRC);
const MOTION_DIR = join(SRC, "components", "motion");
const motionComponents = sourceFiles(MOTION_DIR)
  .filter((file) => !/\.test\.tsx?$/.test(file))
  .map((file) => relative(SRC, file).replace(/\\/g, "/"));

const css = readFileSync(join(SRC, "index.css"), "utf8");

describe("motion surface", () => {
  it("never imports a motion.* component, only the m proxy", () => {
    const offenders = ALL.filter((file) => {
      const text = readFileSync(file, "utf8");
      return (
        text.includes("motion/react") &&
        /(?:^|[{,\s])motion(?:\s*[,}]|\s+as\b)/.test(text)
      );
    }).map((file) => relative(SRC, file).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });

  it("keeps every effect in components/motion reachable from a page or component", () => {
    // The provider is mounted by App; the feature bundle is reached only through
    // it, which is what keeps domMax out of the entry chunk. Neither can have an
    // importer in JSX that a test would find by name.
    const allowedWithoutImporters = [
      "components/motion/provider.tsx",
      "components/motion/features.ts",
    ];

    const unreachable = motionComponents.filter((rel) => {
      if (allowedWithoutImporters.includes(rel)) return false;
      const stem = rel.replace(/^components\//, "").replace(/\.[^.]+$/, "");
      return !ALL.some(
        (file) =>
          !file.includes(`${join("components", "motion")}`) &&
          readFileSync(file, "utf8").includes(stem),
      );
    });

    expect(unreachable).toEqual([]);
  });

  it("lists every decorative animation in the reduced-motion block", () => {
    const reduceBlock = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduceBlock.length).toBeGreaterThan(0);

    for (const selector of [
      ".stagger > *",
      ".animate-rise-sm",
      ".confetti-piece",
      ".credit-name::after",
      ".text-sweep",
    ]) {
      expect(reduceBlock, `${selector} survives reduced motion`).toContain(
        selector,
      );
    }
  });

  it("defines the classes the motion components write", () => {
    for (const cls of ["confetti-piece", "credit-name", "text-sweep"]) {
      expect(css).toContain(`.${cls}`);
    }
  });

  it("holds no route animation that AnimatePresence replaced", () => {
    // The page transition lives in React now; a leftover `.page-enter` would be
    // an invisible second entrance racing the crossfade.
    expect(css).not.toContain("page-enter");
  });
});
