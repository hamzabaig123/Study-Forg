import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ShareLink } from "@/types";
import { Check, Copy, Link2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface ShareLinkPanelProps {
  shares: ShareLink[];
  /** Absolute URL for a token, e.g. `${origin}/shared/${token}`. */
  buildUrl: (token: string) => string;
  onRevoke: (token: string) => void;
  isRevoking: boolean;
  revokingToken: string | null;
  /** A freshly created token: auto-copied and highlighted for a beat. */
  highlightToken?: string | null;
  className?: string;
}

/** Copy that survives browsers without the async clipboard API. */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path — a rejected permission is common in
      // non-focused iframes and older Safari.
    }
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * The list of existing public share links with copy and revoke controls.
 * Revoking is destructive and irreversible, so it is styled as such.
 */
export function ShareLinkPanel({
  shares,
  buildUrl,
  onRevoke,
  isRevoking,
  revokingToken,
  highlightToken = null,
  className,
}: ShareLinkPanelProps) {
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const highlightAppliedRef = useRef<string | null>(null);

  const copyLink = useCallback(
    async (token: string): Promise<boolean> => {
      const ok = await copyText(buildUrl(token));
      if (ok) {
        setCopiedToken(token);
        window.setTimeout(() => {
          setCopiedToken((current) => (current === token ? null : current));
        }, 2000);
      } else {
        toast.error(
          "Couldn't copy automatically — select the link text instead.",
        );
      }
      return ok;
    },
    [buildUrl],
  );

  // A link created a moment ago is copied for the user and ringed so it's
  // findable in a long list. Once per token, and never on mount for old lists.
  useEffect(() => {
    if (!highlightToken || highlightAppliedRef.current === highlightToken) {
      return;
    }
    highlightAppliedRef.current = highlightToken;
    void copyLink(highlightToken);
  }, [highlightToken, copyLink]);

  return (
    <Card
      data-ocid="share.links_panel"
      className={cn(
        "gap-0 rounded-lg border-border/70 py-0 shadow-none",
        className,
      )}
    >
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <CardTitle className="flex items-center gap-2 font-display text-base font-semibold">
          <Link2 className="size-4 text-muted-foreground" aria-hidden="true" />
          Active share links
        </CardTitle>
        {shares.length > 0 ? (
          <span className="numeric text-xs text-muted-foreground">
            {shares.length} {shares.length === 1 ? "link" : "links"}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="px-0 py-0">
        {shares.length === 0 ? (
          <EmptyState
            icon={Link2}
            title="No share links yet"
            description="Generate a link above to publish a chapter or topic as a read-only page anyone can open."
            className="border-0 bg-transparent py-10"
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {shares.map((share, index) => {
              const url = buildUrl(share.token);
              const isCopied = copiedToken === share.token;
              const isFresh = share.token === highlightToken;
              const isRevokingThis =
                isRevoking && revokingToken === share.token;
              return (
                <li
                  key={share.token}
                  data-ocid={`share.link.${index}`}
                  className={cn(
                    "flex flex-col gap-3 px-5 py-4 transition-smooth sm:flex-row sm:items-center",
                    isFresh && "bg-primary/5 ring-1 ring-inset ring-primary/30",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-foreground">
                      {url}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created {formatDateTime(share.createdAt)}
                      {share.target.__kind__ === "topic"
                        ? " · single topic"
                        : " · whole chapter"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 rounded-full"
                      onClick={() => void copyLink(share.token)}
                      data-ocid={`share.copy_button.${index}`}
                    >
                      {isCopied ? (
                        <Check
                          className="size-3.5 text-success"
                          aria-hidden="true"
                        />
                      ) : (
                        <Copy className="size-3.5" aria-hidden="true" />
                      )}
                      {isCopied ? "Copied" : "Copy"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 rounded-full text-destructive hover:text-destructive"
                      onClick={() => onRevoke(share.token)}
                      disabled={isRevokingThis}
                      data-ocid={`share.revoke_button.${index}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      {isRevokingThis ? "Revoking…" : "Revoke"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
