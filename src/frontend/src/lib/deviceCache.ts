/**
 * Device-local caches: everything this browser keeps outside the account
 * record. "Clear local data" erases these and nothing else, so the caller's
 * classes, notes and history stay safe in the canister.
 */
const EXACT_KEYS = [
  "studyforge-theme",
  "studyforge.ai.provider",
  "studyforge.ai.gemini_key",
  "studyforge.ai.openrouter_key",
  "studyforge.ai.openai_key",
];

const KEY_PREFIXES = ["studyforge.note-draft."];

export function clearDeviceCache(): void {
  for (const key of EXACT_KEYS) {
    window.localStorage.removeItem(key);
  }
  const prefixed: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key && KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      prefixed.push(key);
    }
  }
  for (const key of prefixed) {
    window.localStorage.removeItem(key);
  }
}
