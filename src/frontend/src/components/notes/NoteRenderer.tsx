import type { NoteBlock, NoteDocument } from "@/lib/noteDocument";
import { parseNoteDocument } from "@/lib/noteDocument";
import { cn } from "@/lib/utils";

/**
 * Read-only renderer for a stored block document.
 *
 * The editor preview and the public shared view both render through this
 * component, so a reader sees exactly what the author wrote. It accepts either
 * a parsed document or the raw stored JSON string.
 */

function BlockView({ block }: { block: NoteBlock }) {
  switch (block.kind) {
    case "heading":
      return (
        <h2
          className="font-display text-xl font-semibold tracking-tight break-words text-foreground sm:text-2xl"
          data-block="heading"
        >
          {block.text || "\u00a0"}
        </h2>
      );
    case "paragraph":
      return (
        <p
          className="text-sm leading-relaxed break-words text-foreground/90 sm:text-base"
          data-block="paragraph"
        >
          {block.text || "\u00a0"}
        </p>
      );
    case "bulletList":
      return (
        <ul
          className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/90 sm:text-base"
          data-block="bullet-list"
        >
          {block.items.map((item, index) => (
            <li key={`${block.id}-item-${index}`}>{item || "\u00a0"}</li>
          ))}
        </ul>
      );
    case "callout":
      return (
        <aside className="callout-rule" data-block="callout">
          <p className="text-sm leading-relaxed text-foreground/90">
            {block.text || "\u00a0"}
          </p>
        </aside>
      );
    case "formula":
      return (
        <div
          className="surface-code overflow-x-auto rounded-md px-4 py-3 text-sm"
          data-block="formula"
        >
          <code className="whitespace-pre-wrap break-words">
            {block.text || "\u00a0"}
          </code>
        </div>
      );
    case "divider":
      return <hr className="border-t border-border" data-block="divider" />;
  }
}

interface NoteRendererProps {
  /** A parsed document, or the raw stored JSON string. */
  document: NoteDocument | string;
  className?: string;
}

export function NoteRenderer({ document, className }: NoteRendererProps) {
  const parsed =
    typeof document === "string" ? parseNoteDocument(document) : document;

  return (
    <article className={cn("block-stack", className)} data-ocid="note.renderer">
      {parsed.blocks.map((block) => (
        <BlockView key={block.id} block={block} />
      ))}
    </article>
  );
}
