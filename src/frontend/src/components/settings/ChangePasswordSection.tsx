import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEmailPasswordAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Signed-in password change (Supabase mode only — `changePassword` is null
 * everywhere else and the section hides itself).
 *
 * The current password is collected here and verified by the session store
 * before the new one is sent: reaching an unlocked session must never be
 * enough to rotate the real owner out of their account. The new password is
 * also checked against public breach corpora before it travels (k-anonymity
 * range query — see `breachReason`), because GoTrue's own breach switch is
 * plan-gated on this project.
 */
export function ChangePasswordSection() {
  const { changePassword } = useEmailPasswordAuth();
  const [current, setCurrent] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  if (!changePassword) {
    return null;
  }
  const change = changePassword;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      await change(current, nextPassword, confirmation);
      toast.success("Password changed. You stay signed in on this device.");
      setCurrent("");
      setNextPassword("");
      setConfirmation("");
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "The password could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4"
      data-ocid="settings.security.password.section"
    >
      <div className="min-w-0">
        <p className="font-display text-base text-card-foreground">
          Change password
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Your current password is asked first, so a session left open cannot
          lock you out. Other devices will need the new one at next sign-in.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="settings-password-current">Current password</Label>
          <Input
            id="settings-password-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            required
            data-ocid="settings.security.password.current_input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="settings-password-new">New password</Label>
          <Input
            id="settings-password-new"
            type="password"
            autoComplete="new-password"
            value={nextPassword}
            onChange={(event) => setNextPassword(event.target.value)}
            required
            data-ocid="settings.security.password.new_input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="settings-password-confirm">Repeat new password</Label>
          <Input
            id="settings-password-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            data-ocid="settings.security.password.confirm_input"
          />
        </div>
      </div>
      {problem ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {problem}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={busy}
          className="rounded-full"
          data-ocid="settings.security.password.submit_button"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {busy ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
