import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useDigestInput,
  useReminderSettings,
  useSendTestDigest,
} from "@/hooks/useReminders";
import { saveReminderSettings } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import {
  BellRing,
  Clock,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const OCID = "settings.reminders";

/**
 * Daily reminder + analytics-report settings. Delivery runs through the
 * sender's own EmailJS account; without it the digest falls back to a
 * browser notification so the nudge still arrives while the app is open.
 */
export function RemindersSection() {
  const settings = useReminderSettings();
  const digestInput = useDigestInput();
  const { send, sending } = useSendTestDigest();
  const [email, setEmail] = useState(settings.email);
  const [time, setTime] = useState(settings.time);
  const [serviceId, setServiceId] = useState(settings.emailjsServiceId);
  const [templateId, setTemplateId] = useState(settings.emailjsTemplateId);
  const [publicKey, setPublicKey] = useState(settings.emailjsPublicKey);

  const emailConfigured =
    serviceId.trim() && templateId.trim() && publicKey.trim();

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
    if (next && !emailConfigured) {
      const granted = await requestNotifications();
      if (!granted) return;
    }
    commit({ enabled: next });
    toast.success(
      next
        ? emailConfigured
          ? "Daily email reminder is on."
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
      emailjsServiceId: serviceId.trim(),
      emailjsTemplateId: templateId.trim(),
      emailjsPublicKey: publicKey.trim(),
    });
    toast.success("Reminder details saved on this device.");
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
          ? `Test digest sent${settings.email ? ` to ${settings.email}` : ""}.`
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
              One message a day at {settings.time}: your task nudge, accuracy,
              and streak. Fires while the app is open on this device.
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
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor={`${OCID}-email`}
            className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
          >
            <Mail className="mr-1 inline size-3" aria-hidden="true" /> Send to
            (email address)
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

      <div
        className="rounded-lg border border-border bg-background p-4"
        data-ocid={`${OCID}.emailjs`}
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 size-4 shrink-0 text-success"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              Email delivery via your own EmailJS account
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              A browser app cannot send mail by itself. Create a free account at
              emailjs.com, add a service, and a template that uses{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
                {"{{subject}}"}
              </code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
                {"{{message}}"}
              </code>
              . Paste the three IDs here — they are stored only on this device
              and erased by “Clear local data”. Without them, the daily digest
              arrives as a browser notification instead.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label
              htmlFor={`${OCID}-service`}
              className="text-xs text-muted-foreground"
            >
              Service ID
            </Label>
            <Input
              id={`${OCID}-service`}
              data-ocid={`${OCID}.service_input`}
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
              placeholder="service_xxxxxxx"
              className="rounded-lg border-input bg-background font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor={`${OCID}-template`}
              className="text-xs text-muted-foreground"
            >
              Template ID
            </Label>
            <Input
              id={`${OCID}-template`}
              data-ocid={`${OCID}.template_input`}
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              placeholder="template_xxxxxxx"
              className="rounded-lg border-input bg-background font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor={`${OCID}-key`}
              className="text-xs text-muted-foreground"
            >
              Public key
            </Label>
            <Input
              id={`${OCID}-key`}
              data-ocid={`${OCID}.key_input`}
              value={publicKey}
              onChange={(event) => setPublicKey(event.target.value)}
              placeholder="xxxxxxxxxxxxxxx"
              className="rounded-lg border-input bg-background font-mono text-xs"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <p className="text-xs text-muted-foreground">
            {emailConfigured
              ? "Email delivery is configured — digests go to your inbox."
              : "No EmailJS account connected — the digest arrives as a notification."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
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
      </div>
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
