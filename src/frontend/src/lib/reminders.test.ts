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
  TEST_COOLDOWN_MS,
  buildDigest,
  getReminderSettings,
  saveReminderSettings,
  sendDigestNow,
  sendTestDigestNow,
  testCooldownRemainingMs,
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
    // `cached` outlives a localStorage clear, so every field a test can move
    // has to be pinned here or the previous test's stamp leaks into this one.
    lastTestAtMs: null,
  });
});

describe("sendDigestNow", () => {
  function stubNotifications(permission: NotificationPermission) {
    // A function rather than a class: it is constructible at any arity, and
    // `permission` is the only member the code under test reads.
    function NotificationStub() {}
    vi.stubGlobal(
      "Notification",
      Object.assign(NotificationStub, {
        permission,
      }),
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

  it("has already stamped the day while the digest is still going out", async () => {
    // Both the next tick and the same account in a second tab read this module
    // synchronously. A stamp that lands only after delivery resolves leaves
    // that whole window believing today is still owed — which is how one day
    // gets mailed twice.
    let stampedDuringSend: string | null | undefined = "never constructed";
    function NotificationStub() {
      stampedDuringSend = getReminderSettings().lastSentDate;
    }
    vi.stubGlobal(
      "Notification",
      Object.assign(NotificationStub, { permission: "granted" }),
    );

    await sendDigestNow(input());

    expect(stampedDuringSend).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("puts the stamp back when the digest did not go out", async () => {
    saveReminderSettings({ lastSentDate: "2026-09-01" });
    stubNotifications("denied");

    const outcome = await sendDigestNow(input());

    expect(outcome.kind).toBe("failed");
    // A failed send is not a day's delivery: keeping the optimistic stamp would
    // cost the learner every retry for the rest of the day.
    expect(getReminderSettings().lastSentDate).toBe("2026-09-01");
  });
});

describe("sendTestDigestNow", () => {
  function stubNotifications(permission: NotificationPermission) {
    function NotificationStub() {}
    vi.stubGlobal(
      "Notification",
      Object.assign(NotificationStub, { permission }),
    );
  }

  it("refuses the second request while this device's minute is still owed", async () => {
    stubNotifications("granted");

    await expect(sendTestDigestNow(input())).resolves.toEqual({
      kind: "sent",
      via: "notification",
    });
    await expect(sendTestDigestNow(input())).resolves.toEqual({
      kind: "skipped",
      reason: "cooling-down",
    });
  });

  it("stamps the minute before the digest is awaited", async () => {
    // The request can take thirty seconds, and a press in a second tab does not
    // see this tab's `sending` flag. Only a stamp written on the way in makes
    // the pair of them one digest instead of two.
    let cooldownDuringSend = 0;
    function NotificationStub() {
      cooldownDuringSend = testCooldownRemainingMs(
        getReminderSettings(),
        Date.now(),
      );
    }
    vi.stubGlobal(
      "Notification",
      Object.assign(NotificationStub, { permission: "granted" }),
    );

    await sendTestDigestNow(input());

    expect(cooldownDuringSend).toBeGreaterThan(0);
  });

  it("lets the next request through once the minute has passed", async () => {
    stubNotifications("granted");
    saveReminderSettings({
      lastTestAtMs: Date.now() - TEST_COOLDOWN_MS - 1,
    });

    await expect(sendTestDigestNow(input())).resolves.toEqual({
      kind: "sent",
      via: "notification",
    });
  });

  it("keeps the cooldown even when the digest failed", async () => {
    stubNotifications("denied");

    await expect(sendTestDigestNow(input())).resolves.toMatchObject({
      kind: "failed",
    });
    // A rolled-back stamp would turn a broken mail service into an unlimited
    // retry loop; a minute costs nobody anything.
    await expect(sendTestDigestNow(input())).resolves.toEqual({
      kind: "skipped",
      reason: "cooling-down",
    });
  });

  it("does not gate the scheduler's own daily digest", async () => {
    stubNotifications("granted");
    saveReminderSettings({ lastTestAtMs: Date.now(), lastSentDate: null });

    await expect(sendDigestNow(input())).resolves.toEqual({
      kind: "sent",
      via: "notification",
    });
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
