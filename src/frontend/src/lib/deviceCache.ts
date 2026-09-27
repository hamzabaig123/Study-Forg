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
  // Per-provider model choices.
  "studyforge.ai.model",
  // Key left behind by the OpenAI provider this fork no longer offers.
  "studyforge.ai.openai_key",
  // Queue left behind by the studio before it moved to `studyforge.ai-studio`.
  "studyforge.ai.extraction_queue.v1",
  // Notification-fallback preferences for the mock mode (no keys are stored).
  "studyforge.reminders.v1",
];

const KEY_PREFIXES = ["studyforge.note-draft.", "studyforge.ai-studio"];

export function clearDeviceCache(): void {
  // Both stores, because a provider key now defaults to the session one ("keep
  // it for this tab only"). The Settings label promises this erases the keys;
  // clearing only localStorage would leave the newest copy exactly where the
  // reviewer cannot see it and cannot remove.
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of EXACT_KEYS) {
      storage.removeItem(key);
    }
    for (const key of prefixedKeys(storage)) {
      storage.removeItem(key);
    }
  }
}

function prefixedKeys(storage: Storage): string[] {
  const found: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      found.push(key);
    }
  }
  return found;
}
