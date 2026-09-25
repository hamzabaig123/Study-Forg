import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAiConfig, useRemoveAiKey, useSaveAiKey } from "@/hooks/useAiStudio";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCheck,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function AiSettings() {
  const [keyInput, setKeyInput] = useState("");
  const [reveal, setReveal] = useState(false);

  const configQuery = useAiConfig();
  const saveKey = useSaveAiKey();
  const removeKey = useRemoveAiKey();

  const hasPersonalKey = configQuery.data?.hasPersonalKey ?? false;
  const keyHint = configQuery.data?.keyHint;

  const trimmed = keyInput.trim();
  const canSave = trimmed.length > 0 && !saveKey.isPending;

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;
    const value = trimmed;
    setKeyInput("");
    setReveal(false);
    saveKey.mutate(value, {
      onSuccess: () => {
        toast.success(
          hasPersonalKey ? "Personal key replaced." : "Personal key saved.",
        );
      },
      onError: (error: Error) => {
        setKeyInput((current) => (current === "" ? value : current));
        toast.error(error.message);
      },
    });
  };

  const handleRemove = () => {
    removeKey.mutate(undefined, {
      onSuccess: () => {
        toast.success("Personal key removed. The built-in AI is still active.");
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    });
  };

  return (
    <div data-ocid="ai_settings.page" className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-3">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 rounded-lg text-muted-foreground"
        >
          <Link to="/ai-studio" data-ocid="ai_settings.back_link">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to AI Studio
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <KeyRound className="size-5" aria-hidden="true" />
          </span>
          <Badge
            variant="secondary"
            className="rounded-full bg-accent/12 text-accent"
          >
            AI settings
          </Badge>
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          Personal OpenAI key
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
          StudyForge generates questions with the platform's built-in AI by
          default. Add your own OpenAI key to route generation through your
          account instead.
        </p>
        <div className="h-0.5 w-24 rounded-full bg-gradient-primary" />
      </header>

      {/* Current status */}
      <Card
        data-ocid="ai_settings.status_card"
        className="rounded-xl border-border bg-card p-5 shadow-subtle md:p-6"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className={
                hasPersonalKey
                  ? "flex size-10 shrink-0 items-center justify-center rounded-lg bg-success/12 text-success"
                  : "flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              }
            >
              {hasPersonalKey ? (
                <CheckCheck className="size-5" aria-hidden="true" />
              ) : (
                <Sparkles className="size-5" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0">
              <p className="font-display text-lg text-card-foreground">
                {configQuery.isLoading
                  ? "Checking configuration…"
                  : hasPersonalKey
                    ? "Personal key configured"
                    : "AI not configured with a personal key"}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {hasPersonalKey
                  ? "Generation uses your saved key. The full key is never shown again."
                  : "No personal key is saved. The built-in AI still works — generation is never blocked."}
              </p>
            </div>
          </div>
          {configQuery.isLoading ? (
            <Skeleton className="h-9 w-32 rounded-lg" />
          ) : hasPersonalKey ? (
            <Button
              type="button"
              variant="outline"
              data-ocid="ai_settings.remove_button"
              disabled={removeKey.isPending}
              onClick={handleRemove}
              className="shrink-0 rounded-lg border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {removeKey.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              Remove key
            </Button>
          ) : null}
        </div>

        {hasPersonalKey && keyHint ? (
          <div className="mt-5 flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
            <ShieldCheck
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Saved key
              </p>
              <p
                data-ocid="ai_settings.key_hint"
                className="numeric mt-0.5 truncate text-sm text-foreground"
              >
                {keyHint}
              </p>
            </div>
          </div>
        ) : null}
      </Card>

      {/* Add / replace */}
      <Card
        data-ocid="ai_settings.form_card"
        className="rounded-xl border-border bg-card p-5 shadow-subtle md:p-6"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="openai-key"
              className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
            >
              {hasPersonalKey ? "Replace key" : "Add key"}
            </Label>
            <div className="relative">
              <Input
                id="openai-key"
                data-ocid="ai_settings.key_input"
                type={reveal ? "text" : "password"}
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                placeholder="sk-…"
                autoComplete="off"
                spellCheck={false}
                className="numeric rounded-lg border-input bg-background pr-11"
              />
              <button
                type="button"
                data-ocid="ai_settings.reveal_toggle"
                aria-label={reveal ? "Hide key" : "Show key"}
                aria-pressed={reveal}
                onClick={() => setReveal((current) => !current)}
                className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:text-foreground"
              >
                {reveal ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste a key from your OpenAI account. It is stored with your
              account and never displayed in full after saving.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              You can replace or remove this key at any time.
            </p>
            <Button
              type="submit"
              data-ocid="ai_settings.save_button"
              disabled={!canSave}
              className="rounded-lg bg-gradient-primary text-primary-foreground shadow-subtle transition-smooth hover:shadow-elevated"
            >
              {saveKey.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="size-4" aria-hidden="true" />
              )}
              {saveKey.isPending
                ? "Saving…"
                : hasPersonalKey
                  ? "Replace key"
                  : "Save key"}
            </Button>
          </div>
        </form>
      </Card>

      {/* Multimodal & Vision AI (Google Gemini & OpenRouter) */}
      <Card
        data-ocid="ai_settings.vision_card"
        className="rounded-xl border-border bg-card p-5 shadow-subtle md:p-6"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <Sparkles className="size-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-bold text-foreground">
                Document Vision & Multimodal Extraction Keys
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                For high-accuracy OCR extraction of scanned PDFs, handwritten
                notes, diagrams, and images in AI Studio.
              </p>
            </div>
          </div>

          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="settings-gemini-key"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Google Gemini API Key (Recommended for OCR)
                </Label>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Get free key
                </a>
              </div>
              <Input
                id="settings-gemini-key"
                type="password"
                placeholder="AIzaSy..."
                defaultValue={
                  localStorage.getItem("studyforge.ai.gemini_key") || ""
                }
                onChange={(e) => {
                  if (e.target.value.trim()) {
                    localStorage.setItem(
                      "studyforge.ai.gemini_key",
                      e.target.value.trim(),
                    );
                  } else {
                    localStorage.removeItem("studyforge.ai.gemini_key");
                  }
                }}
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="settings-openrouter-key"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  OpenRouter API Key
                </Label>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Get key
                </a>
              </div>
              <Input
                id="settings-openrouter-key"
                type="password"
                placeholder="sk-or-v1-..."
                defaultValue={
                  localStorage.getItem("studyforge.ai.openrouter_key") || ""
                }
                onChange={(e) => {
                  if (e.target.value.trim()) {
                    localStorage.setItem(
                      "studyforge.ai.openrouter_key",
                      e.target.value.trim(),
                    );
                  } else {
                    localStorage.removeItem("studyforge.ai.openrouter_key");
                  }
                }}
                className="font-mono text-xs"
              />
            </div>
          </div>
        </div>
      </Card>

      <Card className="rounded-xl border-border bg-muted/30 p-5 shadow-none">
        <div className="flex items-start gap-3">
          <Sparkles
            className="mt-0.5 size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div>
            <p className="font-display text-base text-card-foreground">
              The built-in AI needs no key
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              StudyForge always offers the platform's built-in AI for question
              generation. A personal key is optional and only changes which
              account performs the work.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
