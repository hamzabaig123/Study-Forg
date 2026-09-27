/**
 * The Supabase mirror of the device-local reminder settings.
 *
 * `lib/reminders.ts` owns the settings (it must stay synchronous for
 * `useSyncExternalStore`) and reaches this module only through a dynamic
 * import, which is what keeps `@supabase/supabase-js` out of the main bundle
 * the mock and canister modes ship. The device copy is always written first;
 * this table is the per-account shadow that lets the preference follow the
 * user and lets one day's digest fire once across devices.
 */
import type { ReminderSettings } from "@/lib/reminders";
import { getSupabase } from "@/lib/supabase/client";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { sessionStore } from "@/lib/supabase/session";

/** Only the preference fields leave the device. */
export type RemoteReminderSettings = Partial<
  Pick<
    ReminderSettings,
    "enabled" | "time" | "sendTaskReminder" | "sendDailyReport" | "lastSentDate"
  >
>;

interface ReminderSettingsRow {
  enabled: boolean;
  time_of_day: string;
  send_task_reminder: boolean;
  send_daily_report: boolean;
  last_sent_on: string | null;
}

function mapRow(row: ReminderSettingsRow): RemoteReminderSettings {
  return {
    enabled: row.enabled,
    time: row.time_of_day,
    sendTaskReminder: row.send_task_reminder,
    sendDailyReport: row.send_daily_report,
    lastSentDate: row.last_sent_on,
  };
}

/** The signed-in account's row, or null when the account has none yet. */
export async function loadRemoteReminderSettings(): Promise<RemoteReminderSettings | null> {
  const account = sessionStore().account();
  if (!account) return null;
  const { data, error } = await getSupabase()
    .from("reminder_settings")
    .select(
      "enabled,time_of_day,send_task_reminder,send_daily_report,last_sent_on",
    )
    .eq("user_id", account.id)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data ? mapRow(data as ReminderSettingsRow) : null;
}

/** Create or replace the account's row with the synced fields of a save. */
export async function saveRemoteReminderSettings(
  settings: ReminderSettings,
): Promise<void> {
  const account = sessionStore().account();
  if (!account) return;
  const { error } = await getSupabase()
    .from("reminder_settings")
    .upsert({
      user_id: account.id,
      enabled: settings.enabled,
      time_of_day: settings.time,
      // Minutes EAST of UTC, so a runner that sleeps in UTC can turn the
      // account's "19:00" into the learner's 19:00. Write-only: the device
      // always sends its own current zone, and the row keeps the value from
      // the most recent save.
      utc_offset_minutes: -new Date().getTimezoneOffset(),
      send_task_reminder: settings.sendTaskReminder,
      send_daily_report: settings.sendDailyReport,
      last_sent_on: settings.lastSentDate,
      updated_at: new Date().toISOString(),
    })
    .select();
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Ask the reminder-sender Edge Function to deliver this account's digest now.
 * The server computes the numbers from the database itself, sends the email to
 * the sign-in address, and records the attempt in reminder_log.
 *
 * `daily` says which of the two reasons this is: the scheduler's own run at the
 * account's chosen time, or a press of the test button. The runner stamps the
 * account's `last_sent_on` only for the first, so a test send cannot eat the
 * day's digest.
 */
export async function requestDigest(
  daily: boolean,
): Promise<{ failures: string[] }> {
  const account = sessionStore().account();
  if (!account) throw new Error("Sign in first.");
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in to send a test digest.");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/reminder-sender`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ daily }),
  });
  const payload = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    results?: Array<{ status?: string; detail?: string }>;
  } | null;
  if (!res.ok) {
    throw new Error(
      payload?.error?.message ?? `The mail service answered HTTP ${res.status}`,
    );
  }
  const failures = (payload?.results ?? [])
    .filter((r) => r.status === "failed")
    .map((r) => r.detail ?? "unknown failure");
  return { failures };
}

export interface ReminderLogEntry {
  id: string;
  sentAt: string;
  kind: "daily" | "test";
  status: "sent" | "failed";
  detail: string | null;
}

/** The account's most recent delivery attempts, newest first. */
export async function fetchReminderLog(limit = 5): Promise<ReminderLogEntry[]> {
  const account = sessionStore().account();
  if (!account) return [];
  const { data, error } = await getSupabase()
    .from("reminder_log")
    .select("id,sent_at,kind,status,detail")
    .eq("user_id", account.id)
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (
    data as Array<{
      id: number;
      sent_at: string;
      kind: string;
      status: string;
      detail: string | null;
    }>
  ).map((row) => ({
    id: String(row.id),
    sentAt: row.sent_at,
    kind: row.kind as ReminderLogEntry["kind"],
    status: row.status as ReminderLogEntry["status"],
    detail: row.detail,
  }));
}
