import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Resolves to `domMax` once the separate chunk has arrived. Nothing awaits it:
 * `m.*` elements render as plain DOM until then, so the first paint is never
 * held up by the animation runtime, and an effect that misses its window
 * simply shows its final state.
 */
const loadFeatures = () =>
  import("./features").then((features) => features.default);

/**
 * One Motion provider for the whole app, and the single place the
 * reduced-motion contract is set.
 *
 * The `!important` block in `index.css` cannot reach anything Motion animates,
 * because Motion writes transforms through the Web Animations API rather than
 * through the CSS cascade — so opting out for motion-sensitive users is this
 * provider's job, not the stylesheet's. `reducedMotion="user"` makes Motion
 * refuse position, scale and layout changes while still allowing opacity, which
 * is the whole agreement: nothing moves, some things fade.
 *
 * `strict` is what keeps the bundle honest. Only the `m` proxy components can
 * be used under this provider, so a component cannot silently pull in the
 * larger, eagerly-loaded `motion` API — the runtime is a lazy chunk and the
 * entry only pays for the proxy.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  // Under vitest the features are never loaded at all: elements mount in their
  // final state with no timing to wait for, which is what keeps the suite on
  // the timings it already passes with.
  if (import.meta.env.MODE === "test") {
    return <MotionConfig reducedMotion="always">{children}</MotionConfig>;
  }

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
