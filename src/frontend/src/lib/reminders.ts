import { parseWithBigints, stringifyWithBigints } from "@/lib/bigintJson";
import { safeGetItem, safeSetItem } from "@/lib/localStore";
/**
 * Daily email reminders and the analytics digest.
 *
 * A browser app cannot send mail by itself, so delivery rides on the sender's
 * own free EmailJS account (service + template + public key, all stored
 * device-local and erased by "Clear local data"). While the app is open, a
 * scheduler checks once a minute and fires the day's digest at the configured
 * time; if EmailJS is not configured, the same digest surfaces as a browser
 * notification instead so the nudge still happens.
 */
import { dayKey } from "@/lib/progress";

/* -------------------------------------------------------------------------- */
/* Settings store                                                              */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "studyforge.reminders.v1";

export interface ReminderSettings {
  enabled: boolean;
  /** Recipient address, filled from the sender's EmailJS template when blank. */
  email: string;
  /** Local time of day, `HH:MM` 24-hour. */
  time: string;
  sendTaskReminder: boolean;
  sendDailyReport: boolean;
  emailjsServiceId: string;
  emailjsTemplateId: string;
  emailjsPublicKey: string;
  /** Local day key of the last fired digest, so it fires once per day. */
  lastSentDate: string | null;
}

const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false,
  email: "",
  time: "19:00",
  sendTaskReminder: true,
  sendDailyReport: true,
  emailjsServiceId: "",
  emailjsTemplateId: "",
  emailjsPublicKey: "",
  lastSentDate: null,
};

function isSettings(value: unknown): value is ReminderSettings {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<ReminderSettings>;
  return (
    typeof candidate.enabled === "boolean" && typeof candidate.time === "string"
  );
}

let cached: ReminderSettings | null = null;
const listeners = new Set<() => void>();

function load(): ReminderSettings {
  if (cached) return cached;
  const raw = safeGetItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isSettings(parsed)) {
        cached = { ...DEFAULT_REMINDER_SETTINGS, ...parsed };
        return cached;
      }
    } catch {
      // Fall through to defaults.
    }
  }
  cached = { ...DEFAULT_REMINDER_SETTINGS };
  return cached;
}

function persist(next: ReminderSettings): void {
  cached = next;
  safeSetItem(STORAGE_KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

export function getReminderSettings(): ReminderSettings {
  return load();
}

export function saveReminderSettings(
  update: Partial<ReminderSettings>,
): ReminderSettings {
  const next = { ...load(), ...update };
  persist(next);
  return next;
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export { subscribe as subscribeReminderSettings };

/* -------------------------------------------------------------------------- */
/* Digest builder                                                              */
/* -------------------------------------------------------------------------- */

export interface DigestInput {
  displayName: string | null;
  accuracyPercent: number;
  answeredTotal: number;
  correctTotal: number;
  streakDays: number;
  bestStreakDays: number;
  attemptsToday: number;
  questionsToday: number;
  /** Questions waiting across the library, when known. */
  questionBank: number | null;
  /** Local date, e.g. "Friday, 26 September 2026". */
  dateLabel: string;
}

export interface DigestCopy {
  subject: string;
  message: string;
}

/** The human-readable daily digest both the email and the notification use. */
export function buildDigest(input: DigestInput): DigestCopy {
  const settings = getReminderSettings();
  const accuracy = `${input.accuracyPercent.toFixed(0)}%`;
  const streakLine =
    input.streakDays > 0
      ? `Day streak: ${input.streakDays} (best ${input.bestStreakDays})`
      : "Day streak: 0 — a quick test restarts it";

  const studiedToday = input.attemptsToday > 0;
  const taskLines: string[] = [];
  if (
    settings.sendTaskReminder &&
    input.questionBank !== null &&
    input.questionBank > 0
  ) {
    taskLines.push(
      studiedToday
        ? `You have ${input.questionBank.toLocaleString()} questions waiting — a short run keeps the streak alive.`
        : `${input.questionBank.toLocaleString()} questions are waiting. ${input.streakDays > 0 ? "Ten minutes protects your streak." : "Ten minutes starts your streak."}`,
    );
  } else if (settings.sendTaskReminder) {
    taskLines.push(
      studiedToday
        ? "Nice work today — come back tomorrow to keep the run going."
        : "No test is scheduled — open StudyForge and build one from any mix of subjects.",
    );
  }

  const reportLines: string[] = [];
  if (settings.sendDailyReport) {
    reportLines.push(
      `Overall accuracy: ${accuracy} (${input.correctTotal.toLocaleString()} of ${input.answeredTotal.toLocaleString()} correct)`,
      streakLine,
      `Today: ${input.attemptsToday} ${input.attemptsToday === 1 ? "test" : "tests"}, ${input.questionsToday} questions answered`,
    );
  }

  const greeting = input.displayName ? `Hi ${input.displayName},` : "Hi there,";
  const blocks = [greeting];
  if (taskLines.length > 0)
    blocks.push("", "Your study plan", ...taskLines.map((line) => `• ${line}`));
  if (reportLines.length > 0)
    blocks.push("", "Your numbers", ...reportLines.map((line) => `• ${line}`));
  blocks.push("", "— StudyForge");

  return {
    subject: studiedToday
      ? `StudyForge — ${accuracy} accuracy, ${input.streakDays}-day streak`
      : "StudyForge — your daily study nudge",
    message: blocks.join("\n"),
  };
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                     */
/* -------------------------------------------------------------------------- */

export type SendOutcome =
  | { kind: "sent"; via: "email" | "notification" }
  | { kind: "skipped"; reason: "disabled" | "already-sent" | "not-due" }
  | { kind: "failed"; reason: string };

function isEmailjsConfigured(settings: ReminderSettings): boolean {
  return (
    settings.emailjsServiceId.trim().length > 0 &&
    settings.emailjsTemplateId.trim().length > 0 &&
    settings.emailjsPublicKey.trim().length > 0
  );
}

/** POST the digest through the caller's EmailJS account. */
async function sendViaEmailjs(
  settings: ReminderSettings,
  copy: DigestCopy,
): Promise<void> {
  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: stringifyWithBigints({
      service_id: settings.emailjsServiceId.trim(),
      template_id: settings.emailjsTemplateId.trim(),
      user_id: settings.emailjsPublicKey.trim(),
      template_params: {
        to_email: settings.email.trim(),
        subject: copy.subject,
        message: copy.message,
      },
    }),
  });
  if (!response.ok) {
    const text = (await response.text().catch(() => "")) || "";
    throw new Error(
      text.trim().slice(0, 200) ||
        `EmailJS answered HTTP ${String(response.status)}`,
    );
  }
}

async function sendViaNotification(copy: DigestCopy): Promise<void> {
  if (typeof Notification === "undefined") {
    throw new Error("This browser has no notification support");
  }
  if (Notification.permission !== "granted") {
    throw new Error("Notifications were not allowed");
  }
  const firstLines = copy.message.split("\n").filter(Boolean);
  new Notification(copy.subject, {
    body: firstLines.slice(1, 4).join("\n"),
    tag: "studyforge-daily",
  });
}

/**
 * Fire the digest now — used by the "send test" button and by the scheduler.
 * Marks the day as sent so the scheduler stays quiet afterwards.
 */
export async function sendDigestNow(input: DigestInput): Promise<SendOutcome> {
  const settings = getReminderSettings();
  const copy = buildDigest(input);
  try {
    if (isEmailjsConfigured(settings)) {
      await sendViaEmailjs(settings, copy);
    } else {
      await sendViaNotification(copy);
    }
  } catch (cause) {
    return {
      kind: "failed",
      reason: cause instanceof Error ? cause.message : "Unknown error",
    };
  }
  saveReminderSettings({ lastSentDate: dayKey(Date.now()) });
  return {
    kind: "sent",
    via: isEmailjsConfigured(settings) ? "email" : "notification",
  };
}

/* -------------------------------------------------------------------------- */
/* Scheduler                                                                   */
/* -------------------------------------------------------------------------- */

let schedulerTimer: number | null = null;

function dueToday(settings: ReminderSettings, nowMs: number): boolean {
  if (!settings.enabled) return false;
  const today = dayKey(nowMs);
  if (settings.lastSentDate === today) return false;
  const [hours, minutes] = settings.time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return false;
  const now = new Date(nowMs);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= hours * 60 + minutes;
}

/**
 * Runs the once-a-day check every minute while the app is open. The callback
 * supplies fresh progress data at fire time; it may return null to skip (for
 * example while history is still loading).
 */
export function startReminderScheduler(
  getInput: () => DigestInput | null,
): () => void {
  stopReminderScheduler();
  const tick = async () => {
    const settings = getReminderSettings();
    const nowMs = Date.now();
    if (!dueToday(settings, nowMs)) return;
    const input = getInput();
    if (!input) return;
    await sendDigestNow(input);
  };
  schedulerTimer = window.setInterval(() => void tick(), 60_000);
  void tick();
  return stopReminderScheduler;
}

function stopReminderScheduler(): void {
  if (schedulerTimer !== null) {
    window.clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
