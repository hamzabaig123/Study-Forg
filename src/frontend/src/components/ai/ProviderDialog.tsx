import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProviderState } from "@/hooks/useAiExtraction";
import type { ModelOption } from "@/lib/ai/providers";
import {
  OLLAMA_ORIGIN,
  type ProviderId,
  findProvider,
  keyPersistence,
  listModels,
  maskKey,
  savedModel,
  setSavedModel,
  visibleProviders,
  withCurrent,
} from "@/lib/ai/providers";
import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ProviderState;
  onConnect: (id: ProviderId, key: string, persist?: boolean) => void;
  onChoose: (id: ProviderId) => void;
  onDisconnect: (id: ProviderId) => void;
  onChooseOffline: () => void;
  onFollowKey: () => void;
}

/** Module scope: `SERVER_PROXY_AVAILABLE` cannot change while the page is open. */
const LISTED = visibleProviders();

/**
 * Choosing what reads the document: a model behind the reviewer's own key, a
 * local Ollama model, or the rule-based parser. Keys never leave the browser —
 * they are read from local storage by the extraction code and cleared with the
 * rest of the local data, which is what the dialog has to say out loud.
 */
export function ProviderDialog({
  open,
  onOpenChange,
  providers,
  onConnect,
  onChoose,
  onDisconnect,
  onChooseOffline,
  onFollowKey,
}: ProviderDialogProps) {
  const [selected, setSelected] = useState<ProviderId>(LISTED[0].id);
  const [model, setModel] = useState(savedModel(LISTED[0].id));
  /** One draft per provider, so switching tabs never throws a typed key away. */
  const [keyDrafts, setKeyDrafts] = useState<Record<ProviderId, string>>({
    gemini: "",
    openRouter: "",
    ollama: "",
    serverProxy: "",
  });
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState<ProviderId | null>(null);
  /** "Keep on this device" — off means the key dies with the tab. */
  const [persist, setPersist] = useState(false);
  const [models, setModels] = useState<ModelOption[]>(LISTED[0].models);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const wasOpen = useRef(open);

  useEffect(() => {
    // Only on the closed-to-open transition: resetting whenever the provider
    // state changed wiped a key typed into the box, which is how keys ended up
    // never being saved.
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    const next =
      providers.preference && providers.preference !== "offline"
        ? providers.preference
        : (providers.active?.provider.id ?? LISTED[0].id);
    setSelected(next);
    setModel(savedModel(next));
    setKeyDrafts({ gemini: "", openRouter: "", ollama: "", serverProxy: "" });
    // Show what is actually stored: a key saved on the device before this
    // default changed stays there until the reviewer clears it, and the toggle
    // would be lying if it opened switched off.
    setPersist(keyPersistence(next) === "device");
    setReveal(false);
    setSaved(null);
    setReload(0);
  }, [open, providers.preference, providers.active]);

  // OpenRouter and Ollama publish the models they serve, and both lists change
  // without warning, so the picker reads them rather than trusting the seed.
  useEffect(() => {
    if (!open) return;
    const provider = findProvider(selected);
    if (!provider) return;
    if (!provider.liveModels) {
      setModels(withCurrent(provider.models, savedModel(provider.id)));
      setModelError(null);
      return;
    }
    let cancelled = false;
    setLoadingModels(true);
    setModelError(null);
    listModels(provider.id, reload > 0)
      .then((list) => {
        if (cancelled) return;
        setModels(withCurrent(list, savedModel(provider.id)));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setModels(withCurrent(provider.models, savedModel(provider.id)));
        setModelError(
          cause instanceof Error
            ? cause.message
            : "Could not load the model list.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selected, reload]);

  const provider = LISTED.find((entry) => entry.id === selected) ?? LISTED[0];
  const savedKey = providers.keys[provider.id] ?? "";
  const trimmed = keyDrafts[provider.id].trim();
  const current = models.find((entry) => entry.id === model) ?? null;

  const useOffline = providers.offlineChosen;
  // The provider extraction would use if the dialog closed right now.
  const willRun = provider.requiresKey ? Boolean(trimmed || savedKey) : true;

  const selectModel = (value: string) => {
    setModel(value);
    setSavedModel(provider.id, value);
  };

  const selectProvider = (id: ProviderId) => {
    setSelected(id);
    setModel(savedModel(id));
    setSaved(null);
    setReload(0);
    if (!useOffline) onFollowKey();
  };

  /**
   * Saves without closing: with a key saved the reviewer can still press
   * "Use {provider}", and a key typed for one provider is not lost by looking
   * at another.
   */
  const saveDraft = () => {
    onConnect(provider.id, trimmed, persist);
    setKeyDrafts((drafts) => ({ ...drafts, [provider.id]: "" }));
    setSaved(provider.id);
  };

  const confirm = () => {
    if (!provider.requiresKey) onChoose(provider.id);
    else if (trimmed) onConnect(provider.id, trimmed, persist);
    else onChoose(provider.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-ocid="ai_studio.provider_dialog">
        <DialogHeader>
          <DialogTitle>Extraction engine</DialogTitle>
          <DialogDescription>
            A vision model reads images and scanned pages. Without a key,
            StudyForge parses the text of your document itself.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            role={useOffline ? undefined : "radiogroup"}
            aria-label="Extraction engine"
            className="space-y-2"
          >
            {LISTED.map((entry) => {
              const key = providers.keys[entry.id] ?? "";
              const isCurrent =
                !useOffline && providers.active?.provider.id === entry.id;
              return (
                <label
                  key={entry.id}
                  className={
                    selected === entry.id
                      ? "flex cursor-pointer items-start gap-3 rounded-lg border border-primary/40 bg-primary/[0.04] p-3"
                      : "flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/40"
                  }
                >
                  <input
                    type="radio"
                    name="ai-provider"
                    className="mt-1 size-4 accent-primary"
                    checked={selected === entry.id}
                    onChange={() => selectProvider(entry.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {entry.name}
                      </span>
                      <span className="numeric text-[11px] text-muted-foreground">
                        {entry.id === selected ? model : savedModel(entry.id)}
                      </span>
                      {isCurrent ? (
                        <Badge className="rounded-full bg-primary/12 text-[11px] text-primary">
                          In use
                        </Badge>
                      ) : null}
                      {!entry.requiresKey ? (
                        <Badge
                          variant="outline"
                          className="rounded-full border-border text-[11px] text-muted-foreground"
                        >
                          No key
                        </Badge>
                      ) : key ? (
                        <Badge
                          variant="outline"
                          className="rounded-full border-success/40 text-[11px] text-success"
                        >
                          Key saved
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {entry.requiresKey
                        ? "Reads text, images and scanned PDF pages."
                        : entry.id === "serverProxy"
                          ? "Your project's Edge Function calls the model with keys stored on the server — nothing to paste, nothing in this browser."
                          : `Runs on the Ollama server on this computer at ${OLLAMA_ORIGIN}.`}
                    </p>
                    {key ? (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="numeric flex items-center gap-1.5 text-xs text-muted-foreground">
                          <ShieldCheck
                            className="size-3.5"
                            aria-hidden="true"
                          />
                          {maskKey(key)}
                        </span>
                        <Button
                          type="button"
                          variant="quiet"
                          size="chip"
                          onClick={() => onDisconnect(entry.id)}
                          className="hover:text-destructive"
                          data-ocid={`ai_studio.disconnect_button.${entry.id}`}
                        >
                          Remove key
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </label>
              );
            })}

            <label
              className={
                useOffline
                  ? "flex cursor-pointer items-start gap-3 rounded-lg border border-primary/40 bg-primary/[0.04] p-3"
                  : "flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/40"
              }
            >
              <input
                type="radio"
                name="ai-provider"
                className="mt-1 size-4 accent-primary"
                checked={useOffline}
                onChange={onChooseOffline}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Zap className="size-4 text-amber-500" aria-hidden="true" />
                  <span className="text-sm font-medium text-foreground">
                    Offline parser
                  </span>
                  {useOffline ? (
                    <Badge className="rounded-full bg-primary/12 text-[11px] text-primary">
                      In use
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Finds numbered questions, lettered options and answer lines in
                  the document text. No key, no upload — and no reading of
                  images.
                </p>
              </div>
            </label>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-muted/25 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor="ai-model"
                className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
              >
                {provider.name} model
              </Label>
              {provider.liveModels ? (
                <Button
                  type="button"
                  variant="quiet"
                  size="chip"
                  onClick={() => setReload((value) => value + 1)}
                  data-ocid="ai_studio.refresh_models_button"
                >
                  <RefreshCw
                    className={loadingModels ? "size-3 animate-spin" : "size-3"}
                    aria-hidden="true"
                  />
                  Reload list
                </Button>
              ) : null}
            </div>
            <Select value={model} onValueChange={selectModel}>
              <SelectTrigger
                id="ai-model"
                className="h-9 w-full bg-background text-sm"
                data-ocid="ai_studio.model_select"
              >
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    <span className="text-sm">
                      {entry.label}
                      {entry.vision ? "" : " · text only"}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loadingModels ? (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                Loading the models {provider.name} serves…
              </p>
            ) : null}
            {modelError ? (
              <p className="text-[11px] leading-relaxed text-destructive">
                {modelError} Showing the models known to StudyForge instead.
              </p>
            ) : null}
            {current && !current.vision ? (
              <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-500">
                This model reads text only, so it cannot see an image or a
                scanned page.
              </p>
            ) : null}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {provider.id === "openRouter"
                ? "Every model OpenRouter currently serves for free, vision-capable ones first."
                : provider.id === "ollama"
                  ? "The models pulled into your local Ollama. Nothing leaves this computer."
                  : provider.id === "serverProxy"
                    ? "The models the project's proxy is configured to forward. Its keys never reach the browser."
                    : "Google's current Flash models, which read text, images and scans."}
            </p>
          </div>

          {provider.requiresKey ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/25 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label
                  htmlFor="ai-provider-key"
                  className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  {savedKey
                    ? `Replace ${provider.name} key`
                    : `${provider.name} key`}
                </Label>
                <a
                  href={provider.keyPage}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                  data-ocid="ai_studio.key_page_link"
                >
                  Get a key
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </div>
              <div className="relative">
                <Input
                  id="ai-provider-key"
                  data-ocid="ai_studio.key_input"
                  type={reveal ? "text" : "password"}
                  value={keyDrafts[provider.id]}
                  onChange={(event) => {
                    const value = event.target.value;
                    setKeyDrafts((drafts) => ({
                      ...drafts,
                      [provider.id]: value,
                    }));
                    setSaved(null);
                  }}
                  placeholder={
                    savedKey
                      ? `A key is already saved (${maskKey(savedKey)}) — paste another only to replace it`
                      : provider.keyPlaceholder
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className="numeric pr-10 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setReveal((current) => !current)}
                  aria-label={reveal ? "Hide key" : "Show key"}
                  className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  {reveal ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Extraction is sent straight from your device to{" "}
                  {provider.name}; StudyForge never stores the key. Left as is,
                  the key is kept until you close this tab — a plaintext value
                  that survives in storage can be read back by anything that
                  ever runs on this page.
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant={persist ? "default" : "outline"}
                    size="chip"
                    aria-pressed={persist}
                    onClick={() => setPersist((current) => !current)}
                    data-ocid="ai_studio.persist_toggle"
                  >
                    {persist ? (
                      <ShieldCheck className="size-3.5" aria-hidden="true" />
                    ) : (
                      <KeyRound className="size-3.5" aria-hidden="true" />
                    )}
                    Keep on this device
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="chip"
                    disabled={trimmed.length === 0}
                    onClick={saveDraft}
                    data-ocid="ai_studio.save_key_button"
                  >
                    <KeyRound className="size-3.5" aria-hidden="true" />
                    Save key
                  </Button>
                </div>
              </div>
              {saved === provider.id ? (
                <p className="flex items-center gap-1.5 text-[11px] text-success">
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  {/* Read back from storage rather than trusting the toggle: an
                      insecure origin refuses the device store, and the line has
                      to say where the key actually went. */}
                  {provider.name} key saved{" "}
                  {keyPersistence(provider.id) === "device"
                    ? "on this device"
                    : "for this tab only"}
                  . Press &ldquo;Use {provider.name}&rdquo; to extract with it.
                </p>
              ) : willRun ? null : (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Paste a {provider.name} key here and press &ldquo;Save
                  key&rdquo;, or use a provider that already has one. Without
                  any key the offline parser reads the document&rsquo;s text.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-border bg-muted/25 p-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                No key needed
              </p>
              {provider.id === "serverProxy" ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  The page you send is read by your Supabase project&rsquo;s{" "}
                  <span className="numeric">ai-proxy</span> function, which
                  holds the provider keys as server-side secrets. Extraction is
                  rate limited per account, and no key is ever sent to this
                  browser.
                </p>
              ) : (
                <>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Ollama runs locally, so StudyForge talks to{" "}
                    <span className="numeric">{OLLAMA_ORIGIN}</span> directly
                    and your pages never leave the machine. Start the server
                    with &ldquo;ollama serve&rdquo; and pull a model such as
                    &ldquo;ollama pull qwen2.5vl:7b&rdquo;.
                  </p>
                  <a
                    href={provider.keyPage}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                    data-ocid="ai_studio.key_page_link"
                  >
                    Install Ollama
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            size="action"
            onClick={() => {
              onChooseOffline();
              onOpenChange(false);
            }}
          >
            Use offline parser
          </Button>
          <Button
            type="button"
            variant="primary"
            size="action"
            disabled={!willRun}
            onClick={confirm}
            data-ocid="ai_studio.connect_button"
          >
            {willRun ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <KeyRound className="size-4" aria-hidden="true" />
            )}
            Use {provider.name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
