/**
 * Who the daily digest goes to, and what it says once it gets there.
 *
 * On the Supabase backend delivery is server-side: `sendDigestNow` hands the
 * request to the reminder-sender Edge Function, which builds the digest from
 * the database and emails the sign-in address — the `recipientEmail` rule and
 * the section switches are asserted there and in the sweep. What this file
 * pins on the client is the mock-mode fallback (the browser notification),
 * the day-stamping that keeps the scheduler quiet, and the two section
 * switches plus the escaping that keeps an account name from becoming markup.
 */
import {
  type DigestInput,
  buildDigest,
  getReminderSettings,
  saveReminderSettings,
  sendDigestNow,
} from "@/lib/reminders";
import { beforeEach, describe, expect, it, vi } from "vitest";

function input(overrides: Partial<DigestInput> = {}): DigestInput {
  return {
    displayName: "Hamza",
    recipientEmail: "account@example.com",
    accuracyPercent: 72.4,
    answeredTotal: 140,
    correctTotal: 101,
    streakDays: 5,
    bestStreakDays: 12,
    attemptsToday: 2,
    questionsToday: 20,
    questionBank: 340,
    dateLabel: "Sunday, 27 September 2026",
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  saveReminderSettings({
    enabled: true,
    email: "device@example.com",
    time: "19:00",
    sendTaskReminder: true,
    sendDailyReport: true,
    lastSentDate: null,
  });
});

describe("sendDigestNow", () => {
  function stubNotifications(permission: NotificationPermission) {
    vi.stubGlobal(
      "Notification",
      class {
        static permission = permission;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        constructor(_title: string, _options?: NotificationOptions) {}
      },
    );
  }

  it("sends the fallback notification and stamps the day as sent", async () => {
    stubNotifications("granted");
    const outcome = await sendDigestNow(input());
    expect(outcome).toEqual({ kind: "sent", via: "notification" });
    expect(getReminderSettings().lastSentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("fails softly when notifications are not allowed", async () => {
    stubNotifications("denied");
    const outcome = await sendDigestNow(input());
    expect(outcome.kind).toBe("failed");
  });
});

describe("buildDigest", () => {
  it("keeps a section out of both renderings when it is turned off", () => {
    saveReminderSettings({ sendTaskReminder: false });
    const copy = buildDigest(input());
    expect(copy.message).not.toContain("questions waiting");
    expect(copy.messageHtml).not.toContain("Your study plan");
    expect(copy.messageHtml).toContain("72%");
  });

  it("drops the report block but keeps the greeting without analytics", () => {
    saveReminderSettings({ sendDailyReport: false });
    const copy = buildDigest(input());
    expect(copy.message).not.toContain("Overall accuracy");
    expect(copy.messageHtml).not.toContain("Questions answered");
    expect(copy.messageHtml).toContain("Hi Hamza,");
  });

  it("escapes an account name and address instead of pasting them as markup", () => {
    const copy = buildDigest(
      input({
        displayName: '<img src=x onerror="steal">',
        recipientEmail: 'x"><script>alert(1)</script>',
      }),
    );
    expect(copy.messageHtml).not.toContain("<img src=x");
    expect(copy.messageHtml).not.toContain("><script>alert");
    expect(copy.messageHtml).toContain("&lt;img src=x onerror=");
  });
});
