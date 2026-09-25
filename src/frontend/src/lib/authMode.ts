/**
 * Which authentication path the app uses.
 *
 * There is deliberately one source of truth rather than a second setting: the
 * localStorage accounts (including the demo account) only exist while the dev
 * mock backend is in use, so `VITE_USE_MOCK=true` selects them and anything
 * else means a real canister, which authenticates through Internet Identity.
 *
 * Read through a module rather than `import.meta.env` at each call site so a
 * test can pin one branch with `vi.mock("@/lib/authMode")`.
 */
export const USE_LOCAL_ACCOUNTS = import.meta.env.VITE_USE_MOCK === "true";
