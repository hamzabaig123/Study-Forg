import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import {
  useDigestInput,
  useReminderLog,
  useReminderSettings,
  useSendTestDigest,
} from "@/hooks/useReminders";
import { USE_SUPABASE } from "@/lib/authMode";
import { saveReminderSettings } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import {
  BellRing,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const OCID = "settings.reminders";

/**
 * Daily reminder + analytics-report settings. On the Supabase backend the
 * digest is delivered by StudyForge's mail runner to the sign-in address —
 * at the account's own local time, whether or not the app is open — and every
 * attempt is recorded in `reminder_log`. On the mock backend the same digest
 * arrives as a browser notification while the app is open.
 */
export function RemindersSection() {
  const settings = useReminderSettings();
  const digestInput = useDigestInput();
  const { account } = useAuth();
  const { send, sending } = useSendTestDigest();
  const log = useReminderLog();
  const [email, setEmail] = useState(settings.email);
  const accountEmail = account?.email ?? null;
  const resolvedRecipient = accountEmail ?? settings.email.trim();
  const [time, setTime] = useState(settings.time);

  function commit(update: Parameters<typeof saveReminderSettings>[0]) {
    saveReminderSettings(update);
  }

  async function requestNotifications(): Promise<boolean> {
    if (typeof Notification === "undefined") {
      toast.error("This browser has no notification support.");
      return false;
    }
    if (Notification.permission === "granted") return true;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toast.error("Notifications stay off until you allow them.");
      return false;
    }
    return true;
  }

  async function handleToggleEnabled() {
    const next = !settings.enabled;
    if (next && !USE_SUPABASE) {
      const granted = await requestNotifications();
      if (!granted) return;
    }
    commit({ enabled: next });
    toast.success(
      next
        ? USE_SUPABASE
          ? "Daily email reminder is on — it arrives at your sign-in address."
          : "Daily reminder is on — you'll get a browser notification."
        : "Daily reminder is off.",
    );
  }

  function handleSaveDetails() {
    const trimmedTime = /^\d{2}:\d{2}$/.test(time.trim())
      ? time.trim()
      : "19:00";
    commit({
      email: email.trim(),
      time: trimmedTime,
    });
    toast.success("Reminder details saved.");
  }

  async function handleSendTest() {
    const outcome = await send();
    if (!outcome) {
      toast.error(
        "Your study numbers are still loading — try again in a moment.",
      );
      return;
    }
    if (outcome.kind === "sent") {
      toast.success(
        outcome.via === "email"
          ? `Test digest sent${
              resolvedRecipient ? ` to ${resolvedRecipient}` : ""
            }.`
          : "Test digest shown as a notification.",
      );
    } else if (outcome.kind === "failed") {
      toast.error(`Couldn't send: ${outcome.reason}`);
    }
  }

  return (
    <div className="mt-5 space-y-4">
      <div
        className={cn(
          "flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between",
        )}
        data-ocid={`${OCID}.master`}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <BellRing className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-base text-card-foreground">
              Daily reminder and analytics report
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              One message a day at {settings.time}
              {accountEmail ? ` to ${accountEmail}` : ""}: your task nudge,
              accuracy, and streak.
              {USE_SUPABASE
                ? " Delivered by StudyForge's mail runner — the app does not need to be open."
                : " Fires while the app is open on this device."}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant={settings.enabled ? "outline" : "default"}
          onClick={() => void handleToggleEnabled()}
          className={cn(
            "shrink-0 rounded-full",
            !settings.enabled &&
              "bg-gradient-primary text-primary-foreground hover:opacity-90",
          )}
          data-ocid={`${OCID}.toggle_button`}
        >
          {settings.enabled ? "Turn off" : "Turn on"}
        </Button>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label
            htmlFor={`${OCID}-time`}
            className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
          >
            <Clock className="mr-1 inline size-3" aria-hidden="true" /> Time of
            day
          </Label>
          <Input
            id={`${OCID}-time`}
            data-ocid={`${OCID}.time_input`}
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="rounded-lg border-input bg-background"
          />
          <p className="text-xs text-muted-foreground">
            Your local time — the mail runner reads this device's zone from the
            browser when settings are saved.
          </p>
        </div>
        <div className="space-y-1.5">
          {accountEmail ? (
            <>
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <Mail className="mr-1 inline size-3" aria-hidden="true" />{" "}
                Delivered to
              </span>
              <p
                className="flex h-9 items-center rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground"
                data-ocid={`${OCID}.email_value`}
              >
                {accountEmail}
              </p>
              <p className="text-xs text-muted-foreground">
                This is your sign-in address — the digest always goes there.
              </p>
            </>
          ) : (
            <>
              <Label
                htmlFor={`${OCID}-email`}
                className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
              >
                <Mail className="mr-1 inline size-3" aria-hidden="true" /> Send
                to (email address)
              </Label>
              <Input
                id={`${OCID}-email`}
                data-ocid={`${OCID}.email_input`}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="rounded-lg border-input bg-background"
              />
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ToggleCard
          checked={settings.sendTaskReminder}
          label="Daily task reminder"
          description="A nudge with how many questions are waiting and how to keep the streak."
          ocid={`${OCID}.task_toggle`}
          onToggle={() =>
            commit({ sendTaskReminder: !settings.sendTaskReminder })
          }
        />
        <ToggleCard
          checked={settings.sendDailyReport}
          label="Daily analytics report"
          description="Accuracy, day streak, and today's answered questions."
          ocid={`${OCID}.report_toggle`}
          onToggle={() =>
            commit({ sendDailyReport: !settings.sendDailyReport })
          }
        />
      </div>

      {USE_SUPABASE ? (
        <div
          className="rounded-lg border border-border bg-background p-4"
          data-ocid={`${OCID}.delivery`}
        >
          <div className="flex items-start gap-3">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-success"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                Email delivery through StudyForge's mail service
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                The mail runner checks every ten minutes and sends each
                account's digest at its own local time — the app does not need
                to be open. The numbers in the email are read from your account,
                and every attempt is recorded below.
              </p>
            </div>
          </div>

          {log.length > 0 ? (
            <ul
              className="mt-4 divide-y divide-border/60 rounded-lg border border-border"
              data-ocid={`${OCID}.log`}
            >
              {log.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm"
                >
                  {entry.status === "sent" ? (
                    <CheckCircle2
                      className="size-4 shrink-0 text-success"
                      aria-hidden="true"
                    />
                  ) : (
                    <XCircle
                      className="size-4 shrink-0 text-destructive"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {entry.status === "failed" && entry.detail
                      ? entry.detail
                      : `${entry.kind === "test" ? "Test" : "Daily"} digest ${
                          entry.status === "sent" ? "sent" : "failed"
                        }`}
                  </span>
                  <span className="numeric shrink-0 text-xs text-muted-foreground">
                    {new Date(entry.sentAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p
              className="mt-4 text-xs text-muted-foreground"
              data-ocid={`${OCID}.log_empty`}
            >
              No delivery attempts yet — the first one lands here.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-4">
            <Button
              type="button"
              variant="outline"
              className="gap-2 rounded-full"
              onClick={handleSaveDetails}
              data-ocid={`${OCID}.save_button`}
            >
              Save details
            </Button>
            <Button
              type="button"
              className="gap-2 rounded-full bg-gradient-primary text-primary-foreground hover:opacity-90"
              onClick={() => void handleSendTest()}
              disabled={sending || !digestInput}
              data-ocid={`${OCID}.test_button`}
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              Send a test now
            </Button>
          </div>
        </div>
      ) : (
        <div
          className="rounded-lg border border-border bg-background p-4"
          data-ocid={`${OCID}.notification_fallback`}
        >
          <div className="flex items-start gap-3">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-success"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              This workspace runs without an email service, so the daily digest
              arrives as a browser notification while the app is open. Connect
              the Supabase backend to get real email delivery to your sign-in
              address.
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-4">
            <Button
              type="button"
              variant="outline"
              className="gap-2 rounded-full"
              onClick={handleSaveDetails}
              data-ocid={`${OCID}.save_button`}
            >
              Save details
            </Button>
            <Button
              type="button"
              className="gap-2 rounded-full bg-gradient-primary text-primary-foreground hover:opacity-90"
              onClick={() => void handleSendTest()}
              disabled={sending || !digestInput}
              data-ocid={`${OCID}.test_button`}
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              Send a test now
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleCard({
  checked,
  label,
  description,
  ocid,
  onToggle,
}: {
  checked: boolean;
  label: string;
  description: string;
  ocid: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-ocid={ocid}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3.5 text-left transition-smooth",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        checked
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-background",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-smooth",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-smooth",
            checked ? "left-[1.125rem]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
