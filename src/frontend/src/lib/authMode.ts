/**
 * Which data backend and authentication path the app uses.
 *
 * There is deliberately one source of truth rather than a second setting: the
 * sign-in method is a property of the store, not a user preference. localStorage
 * accounts (including the demo account) only exist while the mock backend is in
 * use; a Supabase project authenticates through its own session, because row
 * level security keys every row to `auth.uid()`; anything else is the Internet
 * Computer canister, which authenticates through Internet Identity.
 *
 * `selectDataBackend()` in `lib/supabase/env.ts` holds the precedence
 * (`VITE_DATA_BACKEND` wins, then `VITE_USE_MOCK`, then whether a Supabase
 * project is configured). This module only re-exports it as the booleans the
 * hooks branch on.
 *
 * Read through a module rather than `import.meta.env` at each call site so a
 * test can pin one branch with `vi.mock("@/lib/authMode")`.
 */
import { type DataBackend, selectDataBackend } from "@/lib/supabase/env";

export const DATA_BACKEND: DataBackend = selectDataBackend();

/** Email/password accounts in the browser, beside the localStorage mock. */
export const USE_LOCAL_ACCOUNTS = DATA_BACKEND === "mock";

/** The Supabase adapter and Supabase's own session. */
export const USE_SUPABASE = DATA_BACKEND === "supabase";

/**
 * Whether the backend is one plain object instead of a per-principal actor.
 *
 * The mock and the Supabase adapter both answer the whole interface from a single
 * instance that exists before anybody signs in, so both can be resolved before
 * the first render and neither needs the Internet Identity provider mounted
 * around the app.
 */
export const SHARED_BACKEND =
  DATA_BACKEND === "mock" || DATA_BACKEND === "supabase";
