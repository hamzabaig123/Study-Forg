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
import type { ProviderState } from "@/hooks/useAiExtraction";
import { PROVIDERS, type ProviderId, maskKey } from "@/lib/ai/providers";
import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

interface ProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ProviderState;
  onConnect: (id: ProviderId, key: string) => void;
  onDisconnect: (id: ProviderId) => void;
  onChooseOffline: () => void;
  onFollowKey: () => void;
}

/**
 * Choosing what reads the document: a model behind the reviewer's own key, or
 * the rule-based parser. Keys never leave the browser — they are read from
 * local storage by the extraction code and cleared with the rest of the local
 * data, which is what the dialog has to say out loud.
 */
export function ProviderDialog({
  open,
  onOpenChange,
  providers,
  onConnect,
  onDisconnect,
  onChooseOffline,
  onFollowKey,
}: ProviderDialogProps) {
  const [selected, setSelected] = useState<ProviderId>(PROVIDERS[0].id);
  const [keyInput, setKeyInput] = useState("");
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next =
      providers.preference && providers.preference !== "offline"
        ? providers.preference
        : (providers.active?.provider.id ?? PROVIDERS[0].id);
    setSelected(next);
    setKeyInput("");
    setReveal(false);
  }, [open, providers.preference, providers.active]);

  const provider =
    PROVIDERS.find((entry) => entry.id === selected) ?? PROVIDERS[0];
  const savedKey = providers.keys[provider.id] ?? "";
  const trimmed = keyInput.trim();

  const useOffline = providers.offlineChosen;

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
            {PROVIDERS.map((entry) => {
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
                    onChange={() => {
                      setSelected(entry.id);
                      if (!useOffline) onFollowKey();
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {entry.name}
                      </span>
                      <span className="numeric text-[11px] text-muted-foreground">
                        {entry.model}
                      </span>
                      {isCurrent ? (
                        <Badge className="rounded-full bg-primary/12 text-[11px] text-primary">
                          In use
                        </Badge>
                      ) : null}
                      {key ? (
                        <Badge
                          variant="outline"
                          className="rounded-full border-success/40 text-[11px] text-success"
                        >
                          Key saved
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Reads text, images and scanned PDF pages.
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
                          variant="ghost"
                          size="sm"
                          onClick={() => onDisconnect(entry.id)}
                          className="h-7 rounded text-xs text-muted-foreground hover:text-destructive"
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
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                placeholder={provider.keyPlaceholder}
                autoComplete="off"
                spellCheck={false}
                className="numeric pr-10 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setReveal((current) => !current)}
                aria-label={reveal ? "Hide key" : "Show key"}
                className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              >
                {reveal ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Saved in this browser only. Extraction is sent straight from your
              device to {provider.name}; StudyForge never stores the key.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onChooseOffline();
              onOpenChange(false);
            }}
            className="rounded-lg text-xs"
          >
            Use offline parser
          </Button>
          <Button
            type="button"
            disabled={trimmed.length === 0}
            onClick={() => {
              onConnect(provider.id, trimmed);
              onOpenChange(false);
            }}
            className="rounded-lg bg-gradient-primary text-primary-foreground"
            data-ocid="ai_studio.connect_button"
          >
            {trimmed.length === 0 ? (
              <KeyRound className="mr-1.5 size-4" aria-hidden="true" />
            ) : (
              <Check className="mr-1.5 size-4" aria-hidden="true" />
            )}
            Use {provider.name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
