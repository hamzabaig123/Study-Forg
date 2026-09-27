import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEmailPasswordAuth, useInternetIdentityAuth } from "@/hooks/useAuth";
import { USE_LOCAL_ACCOUNTS, USE_SUPABASE } from "@/lib/authMode";
import { SUPABASE_PROBLEM } from "@/lib/supabase/env";
import {
  Link,
  Navigate,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Globe,
  KeyRound,
  LogIn,
  Mail,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Sign-in screen.
 *
 * Which form it shows follows the backend the app is wired to: Internet Identity
 * against a real canister, email/password accounts beside the dev mock backend,
 * and Supabase's own email/password session against the adapter. The last two
 * share a form — only the verification step differs, and that is a prop of the
 * session store rather than a second page. The paths are separate components so
 * neither has to branch mid-render.
 *
 * A Supabase project that cannot be reached is reported here rather than handed
 * to the session store: without a client there is no store to read, and the form
 * would mount over a request that is going to fail anyway.
 */
export default function AuthPage({
  mode,
}: {
  mode: "login" | "register" | "verify" | "forgot" | "reset";
}) {
  if (USE_SUPABASE && SUPABASE_PROBLEM) {
    return <ConnectionProblem message={SUPABASE_PROBLEM} />;
  }
  return USE_LOCAL_ACCOUNTS || USE_SUPABASE ? (
    <EmailPasswordAuthPage mode={mode} />
  ) : (
    <InternetIdentityAuthPage />
  );
}

function ConnectionProblem({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center motion-safe:animate-fade-up px-5 py-12">
      <Card className="w-full">
        <CardHeader>
          <span className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Globe />
          </span>
          <CardTitle>The Supabase project is not usable yet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          <p className="text-sm text-muted-foreground">
            The three values are read from the environment at build time:
            <code className="mx-1 rounded bg-muted px-1">
              VITE_SUPABASE_URL
            </code>
            ,
            <code className="mx-1 rounded bg-muted px-1">
              VITE_SUPABASE_ANON_KEY
            </code>
            and{" "}
            <code className="mx-1 rounded bg-muted px-1">
              VITE_DATA_BACKEND
            </code>
            . Set them in{" "}
            <code className="mx-1 rounded bg-muted px-1">.env.local</code> for
            the dev server, or in the deployment environment, then reload.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Internet Identity                                                           */
/* -------------------------------------------------------------------------- */

function InternetIdentityAuthPage() {
  const { isAuthenticated, isLoggingIn, loginError, login } =
    useInternetIdentityAuth();
  const [ssoDomain, setSsoDomain] = useState("");

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center motion-safe:animate-fade-up px-5 py-12">
      <Card className="w-full shadow-elevated">
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LogIn />
          </div>
          <CardTitle>Sign in to StudyForge</CardTitle>
          <p className="text-sm text-muted-foreground">
            StudyForge uses Internet Identity. It opens in a popup, keeps the
            credential on this device, and needs no password.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            className="w-full"
            disabled={isLoggingIn}
            onClick={() => login()}
            data-ocid="auth.internet_identity_button"
          >
            <KeyRound />
            {isLoggingIn ? "Waiting for Internet Identity…" : "Continue"}
          </Button>
          <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or use an account you already have
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            variant="outline"
            className="w-full"
            disabled={isLoggingIn}
            onClick={() => login({ provider: "google" })}
            data-ocid="auth.google_button"
          >
            <Globe />
            Continue with Google
          </Button>
          <Button
            variant="outline"
            className="w-full"
            disabled={isLoggingIn}
            onClick={() => login({ provider: "microsoft" })}
            data-ocid="auth.microsoft_button"
          >
            <Globe />
            Continue with Microsoft
          </Button>
          <div className="space-y-2 pt-2">
            <Label htmlFor="sso-domain">Company or workspace domain</Label>
            <div className="flex gap-2">
              <Input
                id="sso-domain"
                value={ssoDomain}
                onChange={(e) => setSsoDomain(e.target.value)}
                placeholder="acme.com"
                autoComplete="organization"
              />
              <Button
                variant="outline"
                disabled={isLoggingIn || ssoDomain.trim().length === 0}
                onClick={() => login({ ssoDomain: ssoDomain.trim() })}
                data-ocid="auth.sso_button"
              >
                <Building2 />
                SSO
              </Button>
            </div>
          </div>
          {loginError ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              data-ocid="auth.login_error"
            >
              {loginError.message}
            </p>
          ) : null}
          <p className="pt-3 text-center text-xs text-muted-foreground">
            <Link to="/">Return to the public home page</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Email and password                                                          */
/* -------------------------------------------------------------------------- */

function EmailPasswordAuthPage({
  mode,
}: {
  mode: "login" | "register" | "verify" | "forgot" | "reset";
}) {
  const { signIn, register, startDemo, requestPasswordReset } =
    useEmailPasswordAuth();
  const navigate = useNavigate();
  // `?email=` is how the verification screen hands an address back to the form:
  // a sign-up that needs a link has no session to read one from.
  const pendingEmail = usePendingEmail();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(pendingEmail);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  if (mode === "verify") {
    return <VerifyEmailScreen />;
  }
  if (mode === "forgot") {
    return <ForgotPasswordScreen />;
  }
  if (mode === "reset") {
    return <NewPasswordScreen />;
  }
  const registerMode = mode === "register";
  function useDemo() {
    if (!startDemo) {
      return;
    }
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
      if (!signedIn) {
        // Supabase created the account but will not open a session for an
        // address it has not seen clicked, so the verification screen has to
        // carry the address itself: it is the only door left open.
        toast.success(
          "Account created. Check your inbox to finish signing up.",
        );
        void navigate({ to: "/verify-email", search: { email } });
        return;
      }
      toast.success(
        registerMode
          ? "Account created. Verify your email to continue."
          : "Welcome back.",
      );
      if (signedIn.emailVerified) {
        void navigate({ to: "/dashboard" });
      } else {
        void navigate({
          to: "/verify-email",
          search: { email: signedIn.email },
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not continue.";
      // "Email not confirmed" is the project's answer to a correct password, and
      // a toast about it leaves the visitor with no way forward. The screen that
      // can send the link is one navigation away, and it has the address.
      if (/not confirmed/iu.test(message)) {
        void navigate({ to: "/verify-email", search: { email } });
        return;
      }
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center motion-safe:animate-fade-up px-5 py-12">
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
            {!registerMode && requestPasswordReset && (
              <p className="text-sm text-muted-foreground">
                Forgot it?{" "}
                <Link
                  className="text-primary underline"
                  to="/forgot-password"
                  search={email ? { email } : {}}
                >
                  Send a reset link
                </Link>
              </p>
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
          {!registerMode && startDemo && (
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

/* -------------------------------------------------------------------------- */
/* Verification                                                                */
/* -------------------------------------------------------------------------- */

/** How long a re-send waits before the button lights up again. */
const RESEND_COOLDOWN_SECONDS = 30;

/** How often the screen asks whether the link has been opened yet. */
const SESSION_POLL_MILLISECONDS = 2000;

/**
 * The screen between "account exists" and "account is usable".
 *
 * It runs in two states on purpose. With a session it is a gate: Supabase hands
 * out a token for an address it has not confirmed, and `RequireAuth` sends that
 * session here so no private row is read as an unverified owner. With no session
 * it is an instruction: when confirmation is required `signUp` creates the user
 * and returns nothing to store, so this is the only place a new account learns
 * where its link went and the only way to ask for another one. The address
 * therefore comes from the session when there is one and from `?email=` when
 * there is not.
 *
 * The link is normally opened in a tab the app never sees, and supabase-js
 * reports only changes made in its own tab, so the session is *pulled* on a
 * timer rather than waited on. Re-sending is rate limited by the project rather
 * than by us: its reply is kept on the card, because the wait it describes
 * outlives a toast, and the button rests either way.
 */
function VerifyEmailScreen() {
  const { account, verification, verifyEmail, refreshSession, signOut } =
    useEmailPasswordAuth();
  const pendingEmail = usePendingEmail();
  const address = account?.email ?? pendingEmail;
  const verified = Boolean(account?.emailVerified);
  const navigate = useNavigate();
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = window.setTimeout(
      () => setCooldown((left) => (left > 0 ? left - 1 : 0)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (verified || verification === "local") {
      return;
    }
    // Ask the moment the screen opens: another tab may have confirmed the
    // address before this one existed, and supabase-js is silent about a change
    // it did not make itself. Then keep asking, because the answer arrives in
    // storage rather than as an event.
    void refreshSession();
    const timer = window.setInterval(() => {
      void refreshSession();
    }, SESSION_POLL_MILLISECONDS);
    return () => window.clearInterval(timer);
  }, [refreshSession, verified, verification]);

  // However the address was confirmed — the poll above, or the button below when
  // the dev mock completes it in the browser — there is nothing left for this
  // screen to do.
  useEffect(() => {
    if (verified) {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [navigate, verified]);

  if (!address) {
    return <Navigate to="/login" replace />;
  }

  async function resend() {
    setBusy(true);
    setProblem("");
    try {
      await verifyEmail(address);
      toast.success(
        verification === "local"
          ? "Email verified."
          : `A confirmation link is on its way to ${address}.`,
      );
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "The email could not be sent.",
      );
    } finally {
      setBusy(false);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center motion-safe:animate-fade-up px-5 py-10 sm:py-12">
      <Card className="w-full shadow-elevated">
        <CardHeader>
          <span className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Mail />
          </span>
          <CardTitle>Verify your email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            {account ? (
              <>
                Before you can open your private study space, confirm ownership
                of <strong className="text-foreground">{address}</strong>.
              </>
            ) : (
              <>
                <strong className="text-foreground">{address}</strong> is not
                confirmed yet, so there is nothing to sign in to. Open the link
                sent to it on this device, or ask for a fresh one below.
              </>
            )}
          </p>
          {verification === "local" ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
              Local development mode: email sending is not configured, so
              confirmation is completed here. Connect a server email provider
              before production use.
            </p>
          ) : (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
              Check the inbox and the spam folder of {address}. A link expires,
              so an old message will not work — send a fresh one instead.
            </p>
          )}
          {problem ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {problem}
            </p>
          ) : null}
          <Button
            className="w-full"
            disabled={busy || cooldown > 0}
            onClick={() => {
              void resend();
            }}
          >
            {verification === "local" ? (
              <>
                <CheckCircle2 /> Confirm this email
              </>
            ) : cooldown > 0 ? (
              `Send the link again in ${cooldown}s`
            ) : (
              <>{busy ? "Sending…" : "Send the link again"}</>
            )}
          </Button>
          {account ? (
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
          ) : (
            <p className="text-center text-sm">
              <Link
                className="text-primary underline"
                to="/login"
                search={{ email: address }}
              >
                Back to sign in
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Password reset                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Ask for a reset link.
 *
 * The reply is the same whether or not the address has an account, so the screen
 * repeats it rather than probing: a form that says "no account with that email"
 * is an account list open to anyone who can reach the page. The wait is the
 * project's own rate limit, kept on the card for the same reason the
 * confirmation screen keeps its cooldown.
 */
function ForgotPasswordScreen() {
  const { requestPasswordReset } = useEmailPasswordAuth();
  const pendingEmail = usePendingEmail();
  const [email, setEmail] = useState(pendingEmail);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [problem, setProblem] = useState("");
  const [sent, setSent] = useState("");

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = window.setTimeout(
      () => setCooldown((left) => (left > 0 ? left - 1 : 0)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  if (!requestPasswordReset) {
    return <Navigate to="/login" replace />;
  }
  // Named after the guard rather than read through it: `submit` below is a hoisted
  // declaration, and TypeScript does not carry a narrowing into one.
  const send = requestPasswordReset;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      // Awaited rather than fired and forgotten: the project refuses a redirect
      // it does not recognise, and a screen that said "check your inbox" through
      // that refusal would be the reason nobody ever gets the link.
      await send(email);
      setSent(email);
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "The reset link could not be sent.",
      );
    } finally {
      setBusy(false);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center motion-safe:animate-fade-up px-5 py-10 sm:py-12">
      <Card className="w-full shadow-elevated">
        <CardHeader>
          <span className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Mail />
          </span>
          <CardTitle>Reset your password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Tell StudyForge the address your account was made with and it will
            email a link to choose a new password. The old one keeps working
            until you open it.
          </p>
          {sent ? (
            <output className="block rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
              If <strong className="text-foreground">{sent}</strong> has an
              account, a link is on its way. Check the inbox and the spam
              folder; an old message will not work, so send a fresh one rather
              than opening a stale link.
            </output>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
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
              {problem ? (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {problem}
                </p>
              ) : null}
              <Button
                type="submit"
                className="w-full"
                disabled={busy || cooldown > 0}
              >
                {cooldown > 0
                  ? `Send the link again in ${cooldown}s`
                  : busy
                    ? "Sending…"
                    : "Send the reset link"}
              </Button>
            </form>
          )}
          <p className="text-center text-sm">
            <Link className="text-primary underline" to="/login">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * Choose the new password, after the link has been opened.
 *
 * The link is what puts a session in this browser, so this page has one to work
 * with; opening it by hand does not. `updateUser` is the call that spends the
 * recovery token, and until it succeeds the session stays gated by
 * `RequireAuth` rather than being allowed to read the account.
 */
function NewPasswordScreen() {
  const { isAuthenticated, updatePassword } = useEmailPasswordAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  if (!updatePassword) {
    return <Navigate to="/login" replace />;
  }
  const save = updatePassword;
  if (!isAuthenticated) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center motion-safe:animate-fade-up px-5 py-10 sm:py-12">
        <Card className="w-full shadow-elevated">
          <CardHeader>
            <CardTitle>Open the link from your email</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This page only works from the link StudyForge emailed you, because
              that link is what proves the address is yours. Ask for a new one
              if the message has gone.
            </p>
            <Button
              className="w-full"
              onClick={() => void navigate({ to: "/forgot-password" })}
            >
              Send a reset link
            </Button>
            <p className="text-center text-sm">
              <Link className="text-primary underline" to="/login">
                Back to sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      await save(password, confirmation);
      toast.success("Password changed. You are signed in.");
      void navigate({ to: "/dashboard" });
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
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center motion-safe:animate-fade-up px-5 py-10 sm:py-12">
      <Card className="w-full shadow-elevated">
        <CardHeader>
          <span className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound />
          </span>
          <CardTitle>Choose a new password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm it</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            {problem ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {problem}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Saving…" : "Save the new password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

/** The address `?email=` carries, for a screen with no session to read it from. */
function usePendingEmail(): string {
  return useRouterState({
    select: (state) =>
      (state.location.search as { email?: string } | undefined)?.email ?? "",
  });
}
