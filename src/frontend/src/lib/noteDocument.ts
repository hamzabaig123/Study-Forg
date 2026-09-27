/**
 * Shared block-document model for the Notes workspace.
 *
 * A note body is stored as a JSON string of `{ version: 1, blocks: [...] }`.
 * The editor, the read-only preview, and the public shared view all parse the
 * same stored document through these helpers, so what you edit is exactly what
 * a reader sees.
 *
 * Parsing is total: malformed JSON, unknown block kinds, and missing fields
 * degrade to a safe document instead of throwing, because a note that fails to
 * parse must still open.
 */

const NOTE_DOCUMENT_VERSION = 1 as const;

export type NoteBlockKind =
  | "heading"
  | "paragraph"
  | "bulletList"
  | "callout"
  | "formula"
  | "divider";

interface HeadingBlock {
  id: string;
  kind: "heading";
  text: string;
}

interface ParagraphBlock {
  id: string;
  kind: "paragraph";
  text: string;
}

interface BulletListBlock {
  id: string;
  kind: "bulletList";
  items: string[];
}

interface CalloutBlock {
  id: string;
  kind: "callout";
  text: string;
}

interface FormulaBlock {
  id: string;
  kind: "formula";
  text: string;
}

interface DividerBlock {
  id: string;
  kind: "divider";
}

export type NoteBlock =
  | HeadingBlock
  | ParagraphBlock
  | BulletListBlock
  | CalloutBlock
  | FormulaBlock
  | DividerBlock;

export interface NoteDocument {
  version: typeof NOTE_DOCUMENT_VERSION;
  blocks: NoteBlock[];
}

/** Human labels for the block picker and the editor's block menu. */
export const BLOCK_KIND_LABELS: Record<NoteBlockKind, string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  bulletList: "Bullet list",
  callout: "Callout",
  formula: "Formula",
  divider: "Divider",
};

const BLOCK_KINDS: NoteBlockKind[] = [
  "heading",
  "paragraph",
  "bulletList",
  "callout",
  "formula",
  "divider",
];

let blockCounter = 0;

/** Stable, collision-resistant id for a newly created block. */
function createBlockId(): string {
  blockCounter += 1;
  return `blk-${Date.now().toString(36)}-${blockCounter.toString(36)}`;
}

/** A fresh, empty document with a single paragraph block. */
export function createEmptyDocument(): NoteDocument {
  return {
    version: NOTE_DOCUMENT_VERSION,
    blocks: [{ id: createBlockId(), kind: "paragraph", text: "" }],
  };
}

/** Build a new block of the requested kind, with sensible empty content. */
export function createBlock(kind: NoteBlockKind): NoteBlock {
  const id = createBlockId();
  switch (kind) {
    case "heading":
      return { id, kind, text: "" };
    case "paragraph":
      return { id, kind, text: "" };
    case "bulletList":
      return { id, kind, items: [""] };
    case "callout":
      return { id, kind, text: "" };
    case "formula":
      return { id, kind, text: "" };
    case "divider":
      return { id, kind };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeBlock(raw: unknown, index: number): NoteBlock | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (
    typeof kind !== "string" ||
    !BLOCK_KINDS.includes(kind as NoteBlockKind)
  ) {
    return null;
  }
  const id = typeof raw.id === "string" && raw.id ? raw.id : `blk-${index}`;

  switch (kind as NoteBlockKind) {
    case "heading":
      return { id, kind: "heading", text: asText(raw.text) };
    case "paragraph":
      return { id, kind: "paragraph", text: asText(raw.text) };
    case "bulletList":
      return { id, kind: "bulletList", items: asItems(raw.items) };
    case "callout":
      return { id, kind: "callout", text: asText(raw.text) };
    case "formula":
      return { id, kind: "formula", text: asText(raw.text) };
    case "divider":
      return { id, kind: "divider" };
  }
}

/**
 * Parse a stored document string. Never throws: unreadable input yields an
 * empty document so the note still opens for editing.
 */
export function parseNoteDocument(
  json: string | null | undefined,
): NoteDocument {
  if (!json) return createEmptyDocument();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return createEmptyDocument();
  }
  if (!isRecord(raw) || !Array.isArray(raw.blocks)) {
    return createEmptyDocument();
  }
  const blocks = raw.blocks
    .map((block, index) => normalizeBlock(block, index))
    .filter((block): block is NoteBlock => block !== null);
  return {
    version: NOTE_DOCUMENT_VERSION,
    blocks: blocks.length > 0 ? blocks : createEmptyDocument().blocks,
  };
}

/** Serialize a document for storage. */
export function serializeNoteDocument(document: NoteDocument): string {
  return JSON.stringify({
    version: NOTE_DOCUMENT_VERSION,
    blocks: document.blocks,
  });
}

/**
 * Plain text for the backend's search index. Divider blocks contribute
 * nothing; every other block contributes its text or its list items.
 */
export function extractPlainText(document: NoteDocument): string {
  const parts: string[] = [];
  for (const block of document.blocks) {
    switch (block.kind) {
      case "heading":
      case "paragraph":
      case "callout":
      case "formula":
        if (block.text.trim()) parts.push(block.text.trim());
        break;
      case "bulletList":
        for (const item of block.items) {
          if (item.trim()) parts.push(item.trim());
        }
        break;
      case "divider":
        break;
    }
  }
  return parts.join("\n");
}
