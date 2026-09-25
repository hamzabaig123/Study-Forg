import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import {
  useExportMyData,
  useMySettings,
  useSaveMySettings,
} from "@/hooks/useSettings";
import { shortPrincipal } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SettingsError, ThemeName, UserSettingsView } from "@/types";
import {
  AlertTriangle,
  Check,
  CloudOff,
  CloudUpload,
  Download,
  Flame,
  Loader2,
  Lock,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/* -------------------------------------------------------------------------- */
/* Section model                                                               */
/* -------------------------------------------------------------------------- */

type SectionId = "account" | "appearance" | "privacy" | "security";

interface SectionMeta {
  id: SectionId;
  label: string;
  hint: string;
  Icon: typeof UserRound;
}

const SECTIONS: SectionMeta[] = [
  {
    id: "account",
    label: "Account",
    hint: "Identity and study profile",
    Icon: UserRound,
  },
  {
    id: "appearance",
    label: "Appearance",
    hint: "Light, dark, or frosted",
    Icon: Sun,
  },
  {
    id: "privacy",
    label: "Privacy and export",
    hint: "Your data, on your terms",
    Icon: ShieldCheck,
  },
  {
    id: "security",
    label: "Security",
    hint: "Session and danger zone",
    Icon: Lock,
  },
];

const THEME_CARDS: Array<{
  name: ThemeName;
  label: string;
  hint: string;
  Icon: typeof Sun;
  swatch: string;
}> = [
  {
    name: "light",
    label: "Light",
    hint: "Warm parchment",
    Icon: Sun,
    swatch:
      "linear-gradient(135deg, oklch(0.99 0.008 85), oklch(0.94 0.014 80))",
  },
  {
    name: "dark",
    label: "Dark",
    hint: "Deep indigo ink",
    Icon: Moon,
    swatch:
      "linear-gradient(135deg, oklch(0.22 0.026 265), oklch(0.14 0.022 265))",
  },
  {
    name: "frosted",
    label: "Frosted",
    hint: "Lit glass",
    Icon: Flame,
    swatch:
      "linear-gradient(135deg, oklch(0.86 0.09 60), oklch(0.78 0.07 275))",
  },
];

const DESTRUCTIVE_PHRASE = "clear local data";

const DEFAULT_DAILY_TARGET = 20n;

function normalizeTheme(value: string): ThemeName {
  return value === "dark" || value === "frosted" ? value : "light";
}

/* -------------------------------------------------------------------------- */
/* Sync status                                                                 */
/* -------------------------------------------------------------------------- */

type SyncState = "local" | "pending" | "synced" | "failed";

const SYNC_META: Record<
  SyncState,
  { label: string; hint: string; Icon: typeof Check; tone: string }
> = {
  local: {
    label: "Local only",
    hint: "Changes are not saved yet",
    Icon: CloudOff,
    tone: "text-muted-foreground",
  },
  pending: {
    label: "Pending",
    hint: "Saving your changes…",
    Icon: CloudUpload,
    tone: "text-warning",
  },
  synced: {
    label: "Synced",
    hint: "Everything is saved",
    Icon: Check,
    tone: "text-success",
  },
  failed: {
    label: "Failed",
    hint: "The last save did not go through",
    Icon: AlertTriangle,
    tone: "text-destructive",
  },
};

function SyncStatus({
  state,
  onRetry,
}: {
  state: SyncState;
  onRetry: () => void;
}) {
  const { label, hint, Icon, tone } = SYNC_META[state];
  return (
    <div
      className="flex items-center gap-2.5"
      data-ocid={`settings.sync_status.${state}`}
      aria-live="polite"
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full bg-muted",
          tone,
        )}
      >
        {state === "pending" ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="size-3.5" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold uppercase tracking-widest text-foreground">
          {label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {hint}
        </span>
      </span>
      {state === "failed" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="ml-1 h-7 gap-1.5 rounded-full px-3 text-xs"
          data-ocid="settings.sync_retry_button"
        >
          <RefreshCw className="size-3" aria-hidden="true" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function SettingsPage() {
  const { principal, displayName, isAuthenticated, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const settingsQuery = useMySettings();
  const saveSettings = useSaveMySettings();
  const exportData = useExportMyData();

  const [activeSection, setActiveSection] = useState<SectionId>("account");

  // Draft state — owned locally, seeded once from the backend record.
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [studyGoalDraft, setStudyGoalDraft] = useState("");
  const [dailyTargetDraft, setDailyTargetDraft] = useState("");
  const [appearanceDraft, setAppearanceDraft] = useState<ThemeName>("light");
  const [seeded, setSeeded] = useState(false);
  const [fieldError, setFieldError] = useState<{
    field: "displayName" | "studyGoal" | "dailyTarget" | "appearance";
    message: string;
  } | null>(null);
  const [lastSaveFailed, setLastSaveFailed] = useState(false);

  // Captured before the user can click a theme card, so the first-run baseline
  // reflects the theme this device already applies.
  const [themeAtOpen] = useState(theme);

  // Danger zone state.
  const [dangerOpen, setDangerOpen] = useState(false);
  const [dangerPhrase, setDangerPhrase] = useState("");
  const [dangerReauthed, setDangerReauthed] = useState(false);

  const fetched = settingsQuery.data;

  // The backend only stores a settings row after the first save, so `null` is
  // the normal first-run state rather than a failure. Without a baseline here
  // the page would never report unsaved changes and Save would stay hidden.
  const data = useMemo<UserSettingsView | undefined>(() => {
    if (fetched === undefined) return undefined;
    return (
      fetched ?? {
        displayName: displayName ?? "",
        studyGoal: "",
        dailyTarget: DEFAULT_DAILY_TARGET,
        appearance: themeAtOpen,
        updatedAt: 0n,
      }
    );
  }, [fetched, displayName, themeAtOpen]);

  // Seed the draft exactly once, when the backend record first arrives.
  useEffect(() => {
    if (seeded || !data) return;
    setDisplayNameDraft(data.displayName);
    setStudyGoalDraft(data.studyGoal);
    setDailyTargetDraft(String(data.dailyTarget));
    setAppearanceDraft(normalizeTheme(data.appearance));
    setSeeded(true);
  }, [data, seeded]);

  const parsedTarget = useMemo(() => {
    const trimmed = dailyTargetDraft.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 1 || value > 1000) return null;
    return BigInt(value);
  }, [dailyTargetDraft]);

  const isDirty = useMemo(() => {
    if (!data) return false;
    return (
      displayNameDraft !== data.displayName ||
      studyGoalDraft !== data.studyGoal ||
      String(data.dailyTarget) !== dailyTargetDraft.trim() ||
      appearanceDraft !== data.appearance
    );
  }, [
    data,
    displayNameDraft,
    studyGoalDraft,
    dailyTargetDraft,
    appearanceDraft,
  ]);

  const syncState: SyncState = saveSettings.isPending
    ? "pending"
    : lastSaveFailed
      ? "failed"
      : isDirty
        ? "local"
        : "synced";

  // The backend accepts an empty study goal (it only enforces a max length),
  // so a non-empty goal is not required to save.
  const canSave =
    isDirty &&
    !saveSettings.isPending &&
    displayNameDraft.trim().length > 0 &&
    parsedTarget !== null;

  const applySettingsError = (error: SettingsError): string => {
    if (error.__kind__ === "invalidInput") {
      const message = error.invalidInput;
      const lower = message.toLowerCase();
      const field = lower.includes("name")
        ? "displayName"
        : lower.includes("goal")
          ? "studyGoal"
          : lower.includes("target")
            ? "dailyTarget"
            : lower.includes("appearance")
              ? "appearance"
              : "displayName";
      setFieldError({ field, message });
      return message;
    }
    return "You are not authorized to change these settings.";
  };

  const handleSave = () => {
    if (!canSave || parsedTarget === null) return;
    setFieldError(null);
    saveSettings.mutate(
      {
        displayName: displayNameDraft.trim(),
        studyGoal: studyGoalDraft.trim(),
        dailyTarget: parsedTarget,
        appearance: appearanceDraft,
      },
      {
        onSuccess: (result) => {
          if (result.__kind__ === "err") {
            const message = applySettingsError(result.err);
            setLastSaveFailed(true);
            toast.error(message);
            return;
          }
          setLastSaveFailed(false);
          toast.success("Settings saved.");
        },
        onError: (error: Error) => {
          setLastSaveFailed(true);
          toast.error(error.message || "Could not save your settings.");
        },
      },
    );
  };

  const handleRetry = () => {
    setLastSaveFailed(false);
    handleSave();
  };

  const handleThemeSelect = (next: ThemeName) => {
    setAppearanceDraft(next);
    setTheme(next);
  };

  const handleExport = () => {
    exportData.mutate(undefined, {
      onSuccess: (file) => {
        const blob = new Blob([file.content], {
          type: file.mimeType || "application/json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.filename || "studyforge-export.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success("Your data export has been downloaded.");
      },
      onError: (error: Error) => {
        toast.error(error.message || "Could not export your data.");
      },
    });
  };

  const closeDanger = () => {
    setDangerOpen(false);
    setDangerPhrase("");
    setDangerReauthed(false);
  };

  const handleDangerConfirm = () => {
    closeDanger();
    toast.success("Local data cleared. Signing you out…");
    signOut();
  };

  const sectionRefs = useRef<Record<SectionId, HTMLElement | null>>({
    account: null,
    appearance: null,
    privacy: null,
    security: null,
  });

  const goToSection = (id: SectionId) => {
    setActiveSection(id);
    sectionRefs.current[id]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const resetDraft = () => {
    if (!data) return;
    setDisplayNameDraft(data.displayName);
    setStudyGoalDraft(data.studyGoal);
    setDailyTargetDraft(String(data.dailyTarget));
    setAppearanceDraft(normalizeTheme(data.appearance));
    setTheme(normalizeTheme(data.appearance));
    setFieldError(null);
    setLastSaveFailed(false);
  };

  if (settingsQuery.isLoading) {
    return (
      <div data-ocid="settings.page" className="space-y-6">
        <PageHeader
          eyebrow="Preferences"
          title="Settings"
          description="Manage your study profile, appearance, privacy, and security."
        />
        <LoadingState variant="list" rows={4} label="Loading your settings…" />
      </div>
    );
  }

  if (settingsQuery.isError) {
    return (
      <div data-ocid="settings.page" className="space-y-6">
        <PageHeader
          eyebrow="Preferences"
          title="Settings"
          description="Manage your study profile, appearance, privacy, and security."
        />
        <ErrorState
          title="We couldn't load your settings"
          description="Your preferences are stored with your account. Check your connection and try again."
          onRetry={() => void settingsQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div data-ocid="settings.page" className="space-y-8">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Manage your study profile, appearance, privacy, and security."
        actions={<SyncStatus state={syncState} onRetry={handleRetry} />}
      />

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Section navigation */}
        <nav
          aria-label="Settings sections"
          className="lg:sticky lg:top-24 lg:self-start"
          data-ocid="settings.section_nav"
        >
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {SECTIONS.map(({ id, label, hint, Icon }) => {
              const active = activeSection === id;
              return (
                <li key={id} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    onClick={() => goToSection(id)}
                    aria-current={active ? "true" : undefined}
                    data-ocid={`settings.section_nav.${id}`}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-smooth",
                      active
                        ? "section-rail text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="hidden truncate text-xs text-muted-foreground lg:block">
                        {hint}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Content column */}
        <div className="min-w-0 space-y-6">
          {/* Account */}
          <Card
            ref={(node) => {
              sectionRefs.current.account = node;
            }}
            className="scroll-mt-24 rounded-xl border-border bg-card p-5 shadow-subtle md:p-6"
            data-ocid="settings.account.section"
          >
            <SectionHeading
              Icon={UserRound}
              title="Account"
              description="Your signed-in identity and the profile StudyForge uses to shape practice."
            />

            <div className="mt-5 flex flex-col gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Signed in as
                </p>
                <p
                  className="numeric mt-0.5 truncate text-sm text-foreground"
                  data-ocid="settings.account.principal"
                >
                  {principal ? shortPrincipal(principal) : "Not signed in"}
                </p>
              </div>
              <Badge
                variant="secondary"
                className="w-fit rounded-full bg-success/12 text-success"
              >
                <ShieldCheck className="mr-1 size-3" aria-hidden="true" />
                {isAuthenticated ? "Verified session" : "Signed out"}
              </Badge>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="settings-display-name"
                  className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  Display name
                </Label>
                <Input
                  id="settings-display-name"
                  data-ocid="settings.account.display_name_input"
                  value={displayNameDraft}
                  onChange={(event) => {
                    setDisplayNameDraft(event.target.value);
                    setFieldError(null);
                  }}
                  placeholder={displayName ?? "Your name"}
                  autoComplete="nickname"
                  className="rounded-lg border-input bg-background"
                />
                {fieldError?.field === "displayName" ? (
                  <FieldError message={fieldError.message} />
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="settings-study-goal"
                  className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  Study goal
                </Label>
                <Input
                  id="settings-study-goal"
                  data-ocid="settings.account.study_goal_input"
                  value={studyGoalDraft}
                  onChange={(event) => {
                    setStudyGoalDraft(event.target.value);
                    setFieldError(null);
                  }}
                  placeholder="e.g. Pass the spring biology exam"
                  className="rounded-lg border-input bg-background"
                />
                {fieldError?.field === "studyGoal" ? (
                  <FieldError message={fieldError.message} />
                ) : null}
              </div>

              <div className="space-y-1.5 sm:col-span-2 sm:max-w-xs">
                <Label
                  htmlFor="settings-daily-target"
                  className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  Daily question target
                </Label>
                <Input
                  id="settings-daily-target"
                  data-ocid="settings.account.daily_target_input"
                  inputMode="numeric"
                  value={dailyTargetDraft}
                  onChange={(event) => {
                    setDailyTargetDraft(event.target.value);
                    setFieldError(null);
                  }}
                  placeholder="20"
                  className="numeric rounded-lg border-input bg-background"
                />
                {fieldError?.field === "dailyTarget" ? (
                  <FieldError message={fieldError.message} />
                ) : dailyTargetDraft.trim() !== "" && parsedTarget === null ? (
                  <FieldError message="Enter a whole number between 1 and 1000." />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Between 1 and 1000 questions per day.
                  </p>
                )}
              </div>
            </div>
          </Card>

          {/* Appearance */}
          <Card
            ref={(node) => {
              sectionRefs.current.appearance = node;
            }}
            className="scroll-mt-24 rounded-xl border-border bg-card p-5 shadow-subtle md:p-6"
            data-ocid="settings.appearance.section"
          >
            <SectionHeading
              Icon={Sun}
              title="Appearance"
              description="Pick the surface you study on. Changes apply immediately."
            />

            <div aria-label="Theme" className="mt-5 grid gap-3 sm:grid-cols-3">
              {THEME_CARDS.map(({ name, label, hint, Icon, swatch }) => {
                const selected = appearanceDraft === name;
                const applied = theme === name;
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handleThemeSelect(name)}
                    data-ocid={`settings.appearance.theme_card.${name}`}
                    className={cn(
                      "group flex flex-col gap-3 rounded-xl border p-3 text-left transition-smooth",
                      selected
                        ? "border-primary bg-primary/5 shadow-subtle"
                        : "border-border bg-background hover:border-primary/40 hover:bg-muted/40",
                    )}
                  >
                    <span
                      className="h-16 w-full rounded-lg border border-border"
                      style={{ backgroundImage: swatch }}
                      aria-hidden="true"
                    />
                    <span className="flex items-center gap-2">
                      <Icon
                        className={cn(
                          "size-4",
                          selected ? "text-primary" : "text-muted-foreground",
                        )}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium text-foreground">
                        {label}
                      </span>
                      {selected ? (
                        <Check
                          className="ml-auto size-4 text-primary"
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {hint}
                    </span>
                    {applied ? (
                      <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-primary">
                        Applied now
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {fieldError?.field === "appearance" ? (
              <div className="mt-3">
                <FieldError message={fieldError.message} />
              </div>
            ) : null}
            <p className="mt-4 text-xs text-muted-foreground">
              Your theme is remembered on this device and saved to your account
              when you save changes.
            </p>
          </Card>

          {/* Privacy and export */}
          <Card
            ref={(node) => {
              sectionRefs.current.privacy = node;
            }}
            className="scroll-mt-24 rounded-xl border-border bg-card p-5 shadow-subtle md:p-6"
            data-ocid="settings.privacy.section"
          >
            <SectionHeading
              Icon={ShieldCheck}
              title="Privacy and export"
              description="You own your study data. Take a copy whenever you like."
            />

            <div className="mt-5 flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-display text-base text-card-foreground">
                  Download my data
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  A JSON file with your profile, notes, and practice history.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleExport}
                disabled={exportData.isPending}
                className="shrink-0 gap-2 rounded-full"
                data-ocid="settings.privacy.export_button"
              >
                {exportData.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-4" aria-hidden="true" />
                )}
                {exportData.isPending ? "Preparing…" : "Download my data"}
              </Button>
            </div>

            <div className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-background px-4 py-3">
              <ShieldCheck
                className="mt-0.5 size-4 shrink-0 text-success"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  Your note text is never used in analytics.
                </span>{" "}
                Analytics only ever counts activity such as sessions completed
                and questions answered — never the words you write.
              </p>
            </div>
          </Card>

          {/* Security */}
          <Card
            ref={(node) => {
              sectionRefs.current.security = node;
            }}
            className="scroll-mt-24 rounded-xl border-border bg-card p-5 shadow-subtle md:p-6"
            data-ocid="settings.security.section"
          >
            <SectionHeading
              Icon={Lock}
              title="Security"
              description="Your session is protected by Internet Identity."
            />

            <div className="mt-5 flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-display text-base text-card-foreground">
                  Active session
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Signing out ends this session on this device. Your data stays
                  with your account.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={signOut}
                className="shrink-0 rounded-full"
                data-ocid="settings.security.sign_out_button"
              >
                Sign out
              </Button>
            </div>

            {/* Danger zone */}
            <div
              className="danger-zone mt-6 rounded-xl p-4 md:p-5"
              data-ocid="settings.security.danger_zone"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/12 text-destructive">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="font-display text-base text-foreground">
                    Clear local data and sign out
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Removes your saved theme and cached preferences from this
                    device, then ends your session. Your account data stays safe
                    — download it first if you want a copy.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDangerPhrase("");
                  setDangerReauthed(false);
                  setDangerOpen(true);
                }}
                className="mt-4 rounded-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                data-ocid="settings.security.delete_button"
              >
                Clear local data
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Sticky save bar */}
      {isDirty || saveSettings.isPending || lastSaveFailed ? (
        <div
          className="save-bar -mx-4 px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
          data-ocid="settings.save_bar"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SyncStatus state={syncState} onRetry={handleRetry} />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={resetDraft}
                className="rounded-full"
                data-ocid="settings.discard_button"
              >
                Discard
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                className="gap-2 rounded-full bg-gradient-primary text-primary-foreground shadow-subtle transition-smooth hover:shadow-elevated"
                data-ocid="settings.save_button"
              >
                {saveSettings.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="size-4" aria-hidden="true" />
                )}
                {saveSettings.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Destructive confirmation: typed phrase + re-authentication */}
      <Dialog
        open={dangerOpen}
        onOpenChange={(open) => {
          if (!open) closeDanger();
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          data-ocid="settings.danger_dialog"
        >
          <DialogHeader>
            <DialogTitle className="font-display">
              Clear local data and sign out?
            </DialogTitle>
            <DialogDescription>
              This removes your saved theme and cached preferences from this
              device and ends your session. Your account data is not deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="settings-danger-phrase"
                className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
              >
                Type “{DESTRUCTIVE_PHRASE}” to confirm
              </Label>
              <Input
                id="settings-danger-phrase"
                data-ocid="settings.danger_phrase_input"
                value={dangerPhrase}
                onChange={(event) => setDangerPhrase(event.target.value)}
                placeholder={DESTRUCTIVE_PHRASE}
                autoComplete="off"
                className="rounded-lg border-input bg-background"
              />
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <Lock
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  Re-authentication required
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {dangerReauthed
                    ? "Identity confirmed for this action."
                    : "Confirm your identity before this action can run."}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={dangerReauthed}
                onClick={() => setDangerReauthed(true)}
                className="shrink-0 rounded-full"
                data-ocid="settings.danger_reauth_button"
              >
                {dangerReauthed ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                )}
                {dangerReauthed ? "Verified" : "Verify"}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDanger}
              className="rounded-full"
              data-ocid="settings.danger_cancel_button"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                dangerPhrase.trim().toLowerCase() !== DESTRUCTIVE_PHRASE ||
                !dangerReauthed
              }
              onClick={handleDangerConfirm}
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-ocid="settings.danger_confirm_button"
            >
              Clear local data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                                */
/* -------------------------------------------------------------------------- */

function SectionHeading({
  Icon,
  title,
  description,
}: {
  Icon: typeof UserRound;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <p
      className="flex items-start gap-1.5 text-xs text-destructive"
      role="alert"
      data-ocid="settings.field_error"
    >
      <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}
