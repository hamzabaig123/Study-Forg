/**
 * Supabase connection settings.
 *
 * Which data backend the app talks to is decided once, here, so no component
 * branches at render time. `VITE_USE_MOCK=true` keeps the localStorage mock (dev
 * and the whole test suite); a configured Supabase project selects the real
 * backend; otherwise the Internet Computer canister is used, which is the
 * production default.
 *
 * The URL and the publishable key are not secrets — they identify the project
 * and are shipped in the client bundle, which is only safe because every table
 * is protected by row level security. They still stay out of git: a real key
 * belongs in the deployment environment, and `.env.development` is committed.
 */

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (
  import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
)?.trim();

export type DataBackend = "mock" | "supabase" | "canister";

/**
 * A truncated paste is the likeliest reason a project "does nothing", and both
 * accepted key shapes are long, so a short value is reported instead of being
 * sent on every request and coming back as an unexplained 401.
 */
function looksComplete(candidate: string): boolean {
  if (candidate.startsWith("sb_publishable_")) {
    return candidate.length >= 40;
  }
  return candidate.length >= 100 && candidate.split(".").length === 3;
}

/**
 * Pure so it can be tested against any pair of values: reading `import.meta.env`
 * inside the assertions would make the result depend on whatever `.env.local`
 * happens to exist on the machine running the suite.
 */
export function readSupabaseConfig(
  rawUrl?: string,
  rawKey?: string,
): { url: string; key: string; configured: boolean; problem: string | null } {
  const trimmedUrl = rawUrl?.trim() ?? "";
  const trimmedKey = rawKey?.trim() ?? "";
  if (!trimmedUrl && !trimmedKey) {
    return { url: "", key: "", configured: false, problem: null };
  }
  if (!trimmedUrl) {
    return {
      url: "",
      key: trimmedKey,
      configured: false,
      problem: "VITE_SUPABASE_URL is not set.",
    };
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.[a-z]{2,4}$/i.test(trimmedUrl)) {
    return {
      url: trimmedUrl,
      key: trimmedKey,
      configured: false,
      problem: `VITE_SUPABASE_URL does not look like a Supabase project URL: ${trimmedUrl}`,
    };
  }
  if (!trimmedKey) {
    return {
      url: trimmedUrl,
      key: "",
      configured: false,
      problem: "VITE_SUPABASE_ANON_KEY is not set.",
    };
  }
  if (!looksComplete(trimmedKey)) {
    return {
      url: trimmedUrl,
      key: trimmedKey,
      configured: false,
      problem:
        "VITE_SUPABASE_ANON_KEY looks truncated. Copy the whole publishable key from Project Settings → API keys.",
    };
  }
  return { url: trimmedUrl, key: trimmedKey, configured: true, problem: null };
}

export const SUPABASE_CONFIG = readSupabaseConfig(url, anonKey);

export const SUPABASE_PROBLEM = SUPABASE_CONFIG.problem;
export const SUPABASE_CONFIGURED = SUPABASE_CONFIG.configured;
export const SUPABASE_URL = SUPABASE_CONFIG.url;
export const SUPABASE_ANON_KEY = SUPABASE_CONFIG.key;

/**
 * `VITE_DATA_BACKEND` overrides the choice explicitly (`mock`, `supabase` or
 * `canister`); without it the flag order is the historical one, so nothing that
 * runs today changes behaviour.
 *
 * Called rather than evaluated at import, because Vite loads `.env.local` into
 * `import.meta.env` for every mode including `test`: a value written for the dev
 * server would otherwise follow the suite along with it. `vitest.config.ts` pins
 * both flags empty so the tests always run against the seam they inject actors
 * into.
 */
export function selectDataBackend(): DataBackend {
  const forced = (
    import.meta.env.VITE_DATA_BACKEND as string | undefined
  )?.trim();
  if (forced === "mock" || forced === "supabase" || forced === "canister") {
    return forced;
  }
  if (import.meta.env.VITE_USE_MOCK === "true") {
    return "mock";
  }
  return SUPABASE_CONFIGURED ? "supabase" : "canister";
}
