/**
 * The Motion feature bundle, in a module of its own.
 *
 * `LazyMotion` takes a function returning a promise, and the bundler can only
 * split code that is reachable through a module nothing imports statically.
 * Importing `domMax` straight into the provider would fold it back into the
 * entry chunk, which is the whole cost this file exists to avoid.
 *
 * `domMax` rather than `domAnimation` because the sliding tab pill and the
 * animated lists project layout, and layout animation is not in `domAnimation`.
 */
export { domMax as default } from "motion/react";
