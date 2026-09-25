import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  type AiClientConfig,
  type AiProvider,
  getStoredAiConfig,
  saveStoredAiConfig,
} from "@/lib/ai/aiClient";
import { Check, ExternalLink, KeyRound, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface AiKeyDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: React.ReactNode;
}

export function AiKeyDrawer({ open, onOpenChange, trigger }: AiKeyDrawerProps) {
  const [config, setConfig] = useState<AiClientConfig>(getStoredAiConfig);
  const [geminiKey, setGeminiKey] = useState(config.geminiKey || "");
  const [openRouterKey, setOpenRouterKey] = useState(
    config.openRouterKey || "",
  );
  const [openAiKey, setOpenAiKey] = useState(config.openAiKey || "");
  const [provider, setProvider] = useState<AiProvider>(config.provider);

  useEffect(() => {
    if (open) {
      const current = getStoredAiConfig();
      setConfig(current);
      setGeminiKey(current.geminiKey || "");
      setOpenRouterKey(current.openRouterKey || "");
      setOpenAiKey(current.openAiKey || "");
      setProvider(current.provider);
    }
  }, [open]);

  const handleSave = () => {
    saveStoredAiConfig({
      provider,
      geminiKey: geminiKey.trim() || undefined,
      openRouterKey: openRouterKey.trim() || undefined,
      openAiKey: openAiKey.trim() || undefined,
    });
    toast.success("AI configuration saved.");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-w-lg rounded-xl border-border bg-card p-6 shadow-glass sm:max-w-xl">
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <KeyRound className="size-4" />
            </span>
            <DialogTitle className="font-display text-xl font-bold">
              AI Extraction & Vision Settings
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            Configure how StudyForge extracts MCQs and question-answer pairs
            from your documents and images.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-6">
          <div className="space-y-3">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active Provider
            </Label>
            <RadioGroup
              value={provider}
              onValueChange={(val) => setProvider(val as AiProvider)}
              className="grid gap-3 sm:grid-cols-2"
            >
              <label
                htmlFor="p-builtin"
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-all ${
                  provider === "builtIn"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-card hover:bg-muted/40"
                }`}
              >
                <RadioGroupItem
                  value="builtIn"
                  id="p-builtin"
                  className="mt-0.5"
                />
                <div className="space-y-0.5 text-xs">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <Sparkles className="size-3.5 text-primary" />
                    Built-in Platform AI
                  </div>
                  <p className="text-muted-foreground">
                    Default zero-config inference via Canister.
                  </p>
                </div>
              </label>

              <label
                htmlFor="p-gemini"
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-all ${
                  provider === "gemini"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-card hover:bg-muted/40"
                }`}
              >
                <RadioGroupItem
                  value="gemini"
                  id="p-gemini"
                  className="mt-0.5"
                />
                <div className="space-y-0.5 text-xs">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    Google Gemini
                    <Badge
                      variant="outline"
                      className="h-4 px-1 text-[10px] text-emerald-600 border-emerald-600/30"
                    >
                      Recommended
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">
                    Gemini 2.0 Flash — Best for OCR & vision.
                  </p>
                </div>
              </label>

              <label
                htmlFor="p-openrouter"
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-all ${
                  provider === "openRouter"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-card hover:bg-muted/40"
                }`}
              >
                <RadioGroupItem
                  value="openRouter"
                  id="p-openrouter"
                  className="mt-0.5"
                />
                <div className="space-y-0.5 text-xs">
                  <div className="font-medium text-foreground">OpenRouter</div>
                  <p className="text-muted-foreground">
                    Access any multimodal model via one key.
                  </p>
                </div>
              </label>

              <label
                htmlFor="p-openai"
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-all ${
                  provider === "openAi"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-card hover:bg-muted/40"
                }`}
              >
                <RadioGroupItem
                  value="openAi"
                  id="p-openai"
                  className="mt-0.5"
                />
                <div className="space-y-0.5 text-xs">
                  <div className="font-medium text-foreground">OpenAI</div>
                  <p className="text-muted-foreground">
                    GPT-4o-mini vision & question extraction.
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>

          {/* Provider Specific Inputs */}
          <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
            {provider === "gemini" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="gemini-key" className="text-xs font-semibold">
                    Google Gemini API Key
                  </Label>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    Get free key at Google AI Studio
                    <ExternalLink className="size-3" />
                  </a>
                </div>
                <Input
                  id="gemini-key"
                  type="password"
                  placeholder="AIzaSy..."
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Stored securely in your local browser session. Gemini 2.0
                  Flash provides instant, high-accuracy OCR for PDFs, math
                  formulas, and handwritten notes.
                </p>
              </div>
            )}

            {provider === "openRouter" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="openrouter-key"
                    className="text-xs font-semibold"
                  >
                    OpenRouter API Key
                  </Label>
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    Get key from OpenRouter
                    <ExternalLink className="size-3" />
                  </a>
                </div>
                <Input
                  id="openrouter-key"
                  type="password"
                  placeholder="sk-or-v1-..."
                  value={openRouterKey}
                  onChange={(e) => setOpenRouterKey(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            )}

            {provider === "openAi" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="openai-key" className="text-xs font-semibold">
                    OpenAI API Key
                  </Label>
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    OpenAI Dashboard
                    <ExternalLink className="size-3" />
                  </a>
                </div>
                <Input
                  id="openai-key"
                  type="password"
                  placeholder="sk-proj-..."
                  value={openAiKey}
                  onChange={(e) => setOpenAiKey(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            )}

            {provider === "builtIn" && (
              <p className="text-xs text-muted-foreground">
                Using StudyForge platform AI. No API key is required. All
                standard documents will be parsed and structured through the
                built-in model router.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-lg"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-primary text-primary-foreground shadow-subtle hover:shadow-elevated"
            >
              <Check className="mr-1.5 size-4" />
              Save Configuration
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
