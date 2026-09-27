/**
 * Daily email reminders and the analytics digest.
 *
 * A browser app cannot send mail by itself, so delivery rides on the sender's
 * StudyForge's mail service (the reminder-sender Edge Function), with every
 * attempt recorded in the account's reminder_log table. While the app is open, a
 * scheduler checks once a minute and fires the day's digest at the configured
 * time. With no EmailJS account in the Supabase mode the request goes to the
 * scheduled mail runner instead, and where neither is available the same
 * digest surfaces as a browser notification so the nudge still happens.
 *
 * The digest goes to the address of the account that is signed in — it is read
 * from the session, not typed into a field. The preference itself (on/off,
 * time, sections, last-fired day) is the account's: in the Supabase mode it
 * also mirrors to the per-account `reminder_settings` row, so it follows the
 * user across devices and two devices do not both send the same day's digest.
 */
import { USE_SUPABASE } from "@/lib/authMode";
import { parseWithBigints, stringifyWithBigints } from "@/lib/bigintJson";
import { safeGetItem, safeSetItem } from "@/lib/localStore";
import { dayKey } from "@/lib/progress";

/* -------------------------------------------------------------------------- */
/* Settings store                                                              */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "studyforge.reminders.v1";

export interface ReminderSettings {
  enabled: boolean;
  /** Fallback recipient, used only when the account has no email (Internet Identity). */
  email: string;
  /** Local time of day, `HH:MM` 24-hour. */
  time: string;
  sendTaskReminder: boolean;
  sendDailyReport: boolean;
  /** Local day key of the last fired digest, so it fires once per day. */
  lastSentDate: string | null;
  /**
   * The reviewer's own EmailJS account. Device-local by design — only the
   * fields above mirror to the account's database row.
   */
}

const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false,
  email: "",
  time: "19:00",
  sendTaskReminder: true,
  sendDailyReport: true,
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
/** Bumps on every local write, so a slow remote pull cannot clobber one. */
let localWriteSeq = 0;
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

/** The Supabase shadow of a save. The device copy is written first, always. */
async function pushRemote(next: ReminderSettings): Promise<void> {
  if (!USE_SUPABASE) return;
  try {
    const remote = await import("@/lib/supabase/reminders");
    await remote.saveRemoteReminderSettings(next);
  } catch {
    // Offline or the table is not there yet: the device copy stands, and the
    // next save retries the mirror.
  }
}

/**
 * Read the account's row once per app open and let it win over the device
 * copy for the mirrored fields. A local write that lands while the read is
 * in flight voids the merge rather than racing it.
 */
async function pullRemote(): Promise<void> {
  if (!USE_SUPABASE) return;
  const seqAtStart = localWriteSeq;
  try {
    const remote = await import("@/lib/supabase/reminders");
    const partial = await remote.loadRemoteReminderSettings();
    if (!partial || localWriteSeq !== seqAtStart) return;
    cached = { ...load(), ...partial };
    safeSetItem(STORAGE_KEY, JSON.stringify(cached));
    for (const listener of listeners) listener();
  } catch {
    // Same answer as "no row yet": the device copy stands.
  }
}

function persist(next: ReminderSettings): void {
  cached = next;
  localWriteSeq += 1;
  safeSetItem(STORAGE_KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
  void pushRemote(next);
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
  /** The signed-in account's address — where the digest is delivered. */
  recipientEmail: string | null;
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
  /** Plain text — the browser notification fallback uses it. */
  message: string;
  /** Inline-styled HTML — the designed email card the mail runner sends. */
  messageHtml: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    messageHtml: buildDigestHtml(input),
  };
}

/**
 * The designed counterpart of the plain digest: a 560px card, a warm gradient
 * header, a streak hero, and a 2×2 stat grid. Every style is inline and every
 * layout is a table, which is the subset of HTML mail clients actually render;
 * nothing is loaded from outside the message, so it also clears spam filters
 * that score remote images and fonts.
 */
export function buildDigestHtml(input: DigestInput): string {
  const settings = getReminderSettings();
  const name = input.displayName?.trim();
  const recipient = input.recipientEmail?.trim() ?? "";
  const accuracy = `${input.accuracyPercent.toFixed(0)}%`;
  const studiedToday = input.attemptsToday > 0;
  const subject = studiedToday
    ? `StudyForge — ${accuracy} accuracy, ${input.streakDays}-day streak`
    : "StudyForge — your daily study nudge";
  const preheader = studiedToday
    ? `${input.streakDays}-day streak, ${accuracy} accuracy — today: ${input.questionsToday} questions in ${input.attemptsToday} ${input.attemptsToday === 1 ? "test" : "tests"}.`
    : "A short run today starts the streak — here is what is waiting.";

  const streakHero = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
        <tr>
          <td style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:18px 20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="left" style="font-family:Arial,Helvetica,sans-serif;">
                  <span style="font-size:32px;font-weight:800;color:#ea580c;line-height:1;">${input.streakDays}</span>
                  <span style="font-size:13px;font-weight:700;color:#9a3412;text-transform:uppercase;letter-spacing:0.08em;">&nbsp;day streak</span>
                  <div style="font-size:13px;color:#78716c;margin-top:6px;">${
                    input.streakDays > 0
                      ? `Best so far: ${input.bestStreakDays} days. One short test keeps it alive.`
                      : "No streak yet — one short test starts it."
                  }</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`;

  const statCard = (value: string, label: string) => `
                <td width="50%" style="padding:4px;" valign="top">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="border:1px solid #e7e5e4;border-radius:12px;padding:14px 16px;font-family:Arial,Helvetica,sans-serif;">
                        <div style="font-size:20px;font-weight:800;color:#1c1917;">${value}</div>
                        <div style="font-size:11px;font-weight:700;color:#a8a29e;text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;">${label}</div>
                      </td>
                    </tr>
                  </table>
                </td>`;

  const reportSection = settings.sendDailyReport
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
        <tr>${statCard(accuracy, "Accuracy")}${statCard(
          input.answeredTotal.toLocaleString(),
          "Questions answered",
        )}</tr>
        <tr>${statCard(
          input.correctTotal.toLocaleString(),
          "Correct answers",
        )}${statCard(
          `${input.questionsToday.toLocaleString()} in ${input.attemptsToday} ${input.attemptsToday === 1 ? "test" : "tests"}`,
          "Today",
        )}</tr>
      </table>
      <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#78716c;">Overall that is <strong style="color:#1c1917;">${input.correctTotal.toLocaleString()} of ${input.answeredTotal.toLocaleString()}</strong> correct${
        input.questionBank !== null && input.questionBank > 0
          ? `, with <strong style="color:#1c1917;">${input.questionBank.toLocaleString()}</strong> more questions in the library.`
          : "."
      }</p>`
    : "";

  let planLine = "";
  if (settings.sendTaskReminder) {
    if (input.questionBank !== null && input.questionBank > 0) {
      planLine = studiedToday
        ? `You have ${input.questionBank.toLocaleString()} questions waiting — a short run keeps the streak alive.`
        : `${input.questionBank.toLocaleString()} questions are waiting. ${
            input.streakDays > 0
              ? "Ten minutes protects your streak."
              : "Ten minutes starts your streak."
          }`;
    } else {
      planLine = studiedToday
        ? "Nice work today — come back tomorrow to keep the run going."
        : "No test is scheduled — open StudyForge and build one from any mix of subjects.";
    }
  }

  const planSection = planLine
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
        <tr>
          <td style="border-left:3px solid #f59e0b;background-color:#fffbeb;border-radius:0 12px 12px 0;padding:14px 16px;font-family:Arial,Helvetica,sans-serif;">
            <div style="font-size:11px;font-weight:800;color:#9a3412;text-transform:uppercase;letter-spacing:0.08em;">Your study plan</div>
            <div style="font-size:14px;color:#1c1917;margin-top:4px;line-height:1.5;">${planLine}</div>
          </td>
        </tr>
      </table>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f4;">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f4;">
<tr>
<td align="center" style="padding:32px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
<tr>
<td style="background:linear-gradient(135deg,#f59e0b 0%,#ea580c 100%);border-radius:16px 16px 0 0;padding:26px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td align="left" style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;color:#ffffff;letter-spacing:0.02em;">StudyForge</td>
<td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#ffedd5;">${escapeHtml(
    input.dateLabel,
  )}</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="background-color:#ffffff;border:1px solid #e7e5e4;border-top:none;border-radius:0 0 16px 16px;padding:28px 32px 32px;">
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#1c1917;">${escapeHtml(
    name ? `Hi ${name},` : "Hi there,",
  )}</p>
<p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#78716c;line-height:1.6;">Here is your study day at a glance.</p>
${streakHero}${reportSection}${planSection}
</td>
</tr>
<tr>
<td align="center" style="padding:20px 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a8a29e;line-height:1.7;">
You are receiving this daily digest because reminders are on for the StudyForge account <a href="mailto:${escapeHtml(
    recipient,
  )}" style="color:#78716c;">${escapeHtml(recipient || "signed in on this device")}</a>.<br>
Change the time or turn it off in Settings &rarr; Reminders.
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
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
 * Fire the digest now — the "send test" button and the scheduler both come
 * through here. The recipient is the signed-in account's address; the manually
 * kept fallback only stands in when the account has none (Internet Identity).
 *
 * Delivery is tried in the order the reviewer set it up: their own EmailJS
 * account when the three IDs are on the device, otherwise the scheduled
 * reminder-sender Edge Function in the Supabase mode (which sends from the
 * server and records the attempt in `reminder_log`), otherwise a browser
 * notification. Whichever one runs, the day is stamped so the scheduler stays
 * quiet, and in the Supabase mode that stamp mirrors to the account's row.
 */
export async function sendDigestNow(input: DigestInput): Promise<SendOutcome> {
  const settings = getReminderSettings();
  const copy = buildDigest(input);
  const recipient = input.recipientEmail?.trim() || settings.email.trim();
  const viaEmailjs = isEmailjsConfigured(settings);
  try {
    if (viaEmailjs) {
      await sendViaEmailjs(settings, copy, recipient);
    } else if (USE_SUPABASE) {
      const server = await import("@/lib/supabase/reminders");
      const { failures } = await server.sendTestViaServer();
      if (failures.length > 0) {
        return { kind: "failed", reason: failures[0] };
      }
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
  return { kind: "sent", via: USE_SUPABASE ? "email" : "notification" };
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
 * example while history is still loading). The account's saved preference is
 * pulled once per mount so the scheduler fires on the account's settings, not
 * only this device's.
 */
export function startReminderScheduler(
  getInput: () => DigestInput | null,
): () => void {
  stopReminderScheduler();
  void pullRemote();
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
