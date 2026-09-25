import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Mail,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function AuthPage({
  mode,
}: { mode: "login" | "register" | "verify" }) {
  const { account, signIn, register, startDemo, verifyEmail, signOut } =
    useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  if (mode === "verify") {
    if (!account) {
      void navigate({ to: "/login", replace: true });
      return null;
    }
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-12">
        <Card className="w-full">
          <CardHeader>
            <span className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Mail />
            </span>
            <CardTitle>Verify your email</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Before you can open your private study space, confirm ownership of{" "}
              <strong className="text-foreground">{account.email}</strong>.
            </p>
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              Local development mode: email sending is not configured, so
              confirmation is completed here. Connect a server email provider
              before production use.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                verifyEmail();
                toast.success("Email verified.");
                void navigate({ to: "/dashboard" });
              }}
            >
              <CheckCircle2 /> Confirm this email
            </Button>
            <Button
              className="w-full"
              variant="ghost"
              onClick={() => {
                signOut();
                void navigate({ to: "/" });
              }}
            >
              Use another account
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }
  const registerMode = mode === "register";
  function useDemo() {
    startDemo();
    toast.success("Demo account ready.");
    void navigate({ to: "/dashboard" });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const signedIn = registerMode
        ? await register({
            name,
            email,
            password,
            passwordConfirmation: confirmation,
          })
        : await signIn(email, password);
      toast.success(
        registerMode
          ? "Account created. Verify your email to continue."
          : "Welcome back.",
      );
      void navigate({
        to: signedIn.emailVerified ? "/dashboard" : "/verify-email",
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not continue.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-12">
      <Card className="w-full shadow-elevated">
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            {registerMode ? <UserRound /> : <KeyRound />}
          </div>
          <CardTitle>
            {registerMode ? "Create your StudyForge account" : "Welcome back"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {registerMode
              ? "Your study material stays in your own account."
              : "Sign in to continue learning."}
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            {registerMode && (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  registerMode ? "new-password" : "current-password"
                }
                minLength={8}
                required
              />
            </div>
            {registerMode && (
              <div className="space-y-2">
                <Label htmlFor="confirmation">Confirm password</Label>
                <Input
                  id="confirmation"
                  type="password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy
                ? "Please wait…"
                : registerMode
                  ? "Create account"
                  : "Sign in"}
              <ArrowRight />
            </Button>
          </form>
          {!registerMode && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={useDemo}
              >
                Use demo account
              </Button>
            </>
          )}
          <p className="mt-5 text-center text-sm text-muted-foreground">
            {registerMode ? (
              <>
                Already have an account?{" "}
                <Link className="text-primary underline" to="/login">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New to StudyForge?{" "}
                <Link className="text-primary underline" to="/register">
                  Create an account
                </Link>
              </>
            )}
          </p>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            <Link to="/">Return to the public home page</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
