/**
 * Adapter slice: share tokens, the anonymous readers behind them, and exports.
 *
 * Two different trust levels meet in this file. `createShare`, `listShares` and
 * `revokeShare` are owner calls over row level security. `getSharedContent` and
 * `getSharedNote` are reached by a logged-out visitor holding only a token, so
 * they run as definer functions that answer by token *digest* and return a
 * hand-built payload — `shared_content()` deliberately has no `answer` or
 * `explanation` column in it, because a share is a question sheet, not a mark
 * scheme.
 *
 * The token itself is generated in the browser (`tokens.ts`) and sent to
 * `create_share`, which stores it and its digest. That looks backwards until you
 * notice who has to see it: the owner's list screens re-show the plaintext, so a
 * digest would break the feature, and a database dump that reaches these rows has
 * already reached the notes they point at.
 */
import type {
  BreadcrumbItem,
  EditToken,
  ExportError,
  ExportFormat,
  Id,
  NoteShareError,
  NoteShareLink,
  PublicQuestion,
  ShareError,
  ShareLink,
  ShareTarget,
  SharedContent,
  SharedNote,
  UserDataExport,
  backendInterface,
} from "@/backend";
import { ExportError as ExportErrorEnum } from "@/backend";
import { NoteShareError as NoteShareErrorEnum } from "@/backend";
import { ShareError as ShareErrorEnum } from "@/backend";
import { stringifyWithBigints } from "../../bigintJson";
import { exportFileFor } from "../../questionExport";
import {
  hashToken,
  idArg,
  logActivity,
  questionsInScope,
  requireUserId,
  rpcEnvelope,
  rpcOptional,
  rpcRows,
  scopeColumns,
  withoutFields,
} from "../common";
import {
  activityItemOf,
  chapterSummary,
  classSummary,
  linkDetailOf,
  noteOf,
  noteShareOf,
  questionOf,
  questionTypeOf,
  rpcOk,
  sessionResultOf,
  sessionViewOf,
  settingsOf,
  shareLinkOf,
  subjectSummary,
  toId,
  toStamp,
  toText,
  topicSummary,
} from "../mapping";
import { newShareToken } from "../tokens";
import type { Row, SupabaseTransport } from "../transport";

/** The label a scope exports under, or null when it is not the caller's. */
async function scopeLabel(
  transport: SupabaseTransport,
  target: ShareTarget,
): Promise<string | null> {
  if (target.__kind__ === "topic") {
    const rows = await rpcRows(transport, "topic_rows", {
      p_id: idArg(target.topic),
    });
    return rows.length > 0 ? toText(rows[0].name) : null;
  }
  const rows = await rpcRows(transport, "chapter_rows", {
    p_id: idArg(target.chapter),
  });
  return rows.length > 0 ? toText(rows[0].name) : null;
}

export function createSharingSlice(
  transport: SupabaseTransport,
): Pick<
  backendInterface,
  | "createShare"
  | "listShares"
  | "revokeShare"
  | "getSharedContent"
  | "getSharedNote"
  | "createNoteShare"
  | "listNoteShares"
  | "revokeNoteShare"
  | "exportContent"
  | "exportMyData"
> {
  return {
    /* ------------------------------ content shares ----------------------------- */

    async createShare(target: ShareTarget): Promise<
      | {
          __kind__: "ok";
          ok: ShareLink;
        }
      | {
          __kind__: "err";
          err: ShareError;
        }
    > {
      await requireUserId(transport);
      const label = await scopeLabel(transport, target);
      if (label === null) {
        return { __kind__: "err", err: ShareErrorEnum.notFound };
      }
      const scope = scopeColumns(target);
      const payload = await rpcEnvelope(transport, "create_share", {
        p_scope_kind: scope.scope_kind,
        p_scope_id: scope.scope_id,
        p_token: newShareToken("share"),
      });
      if ("err" in payload && payload.err !== undefined) {
        return { __kind__: "err", err: ShareErrorEnum.notFound };
      }
      await logActivity(
        transport,
        "share",
        `Created a share link for "${label}"`,
      );
      return { __kind__: "ok", ok: shareLinkOf(rpcOk<Row>(payload)) };
    },

    async listShares(): Promise<ShareLink[]> {
      await requireUserId(transport);
      const rows = await transport.read("content_share", {
        order: { column: "created_at", ascending: false },
      });
      return rows.map(shareLinkOf);
    },

    async revokeShare(token: string): Promise<boolean> {
      await requireUserId(transport);
      const written = await transport.write("content_share", {
        eq: { token },
        remove: true,
      });
      return written.length > 0;
    },

    /* -------------------------------- note shares ------------------------------- */

    async createNoteShare(noteId: Id): Promise<
      | {
          __kind__: "ok";
          ok: NoteShareLink;
        }
      | {
          __kind__: "err";
          err: NoteShareError;
        }
    > {
      await requireUserId(transport);
      const payload = await rpcEnvelope(transport, "create_note_share", {
        p_note_id: idArg(noteId),
        p_token: newShareToken("note"),
      });
      if ("err" in payload && payload.err !== undefined) {
        return {
          __kind__: "err",
          err:
            toText(payload.err) === "notFound"
              ? NoteShareErrorEnum.notFound
              : NoteShareErrorEnum.notAuthorized,
        };
      }
      return { __kind__: "ok", ok: noteShareOf(rpcOk<Row>(payload)) };
    },

    async listNoteShares(): Promise<NoteShareLink[]> {
      await requireUserId(transport);
      const rows = await transport.read("note_share", {
        order: { column: "created_at", ascending: false },
      });
      return rows.map(noteShareOf);
    },

    async revokeNoteShare(token: string): Promise<
      | {
          __kind__: "ok";
          ok: null;
        }
      | {
          __kind__: "err";
          err: NoteShareError;
        }
    > {
      await requireUserId(transport);
      const written = await transport.write("note_share", {
        eq: { token },
        remove: true,
      });
      if (written.length === 0) {
        return { __kind__: "err", err: NoteShareErrorEnum.notFound };
      }
      return { __kind__: "ok", ok: null };
    },

    /* ------------------------- anonymous token readers ------------------------- */

    async getSharedContent(token: string): Promise<SharedContent | null> {
      const payload = await rpcOptional(transport, "shared_content", {
        p_token_hash: await hashToken(token),
      });
      if (payload === null) {
        return null;
      }
      const breadcrumb = (
        Array.isArray(payload.breadcrumb) ? payload.breadcrumb : []
      ) as Row[];
      const questions = (
        Array.isArray(payload.questions) ? payload.questions : []
      ) as Row[];
      return {
        title: toText(payload.title),
        breadcrumb: breadcrumb.map(
          (item): BreadcrumbItem => ({
            id: toId(item.id),
            name: toText(item.name),
          }),
        ),
        questions: questions.map(
          (item): PublicQuestion => ({
            id: toId(item.id),
            questionType: questionTypeOf(item.questionType),
            prompt: toText(item.prompt),
            options: Array.isArray(item.options)
              ? (item.options as PublicQuestion["options"])
              : [],
          }),
        ),
      };
    },

    async getSharedNote(token: string): Promise<SharedNote | null> {
      const payload = await rpcOptional(transport, "shared_note", {
        p_token_hash: await hashToken(token),
      });
      if (payload === null) {
        return null;
      }
      return {
        documentJson: toText(payload.documentJson),
        title: toText(payload.title),
        updatedAt: toStamp(payload.updatedAt),
        revision: toId(payload.revision),
      };
    },

    /* ---------------------------------- exports --------------------------------- */

    async exportContent(
      target: ShareTarget,
      format: ExportFormat,
    ): Promise<
      | {
          __kind__: "ok";
          ok: { content: string; mimeType: string; filename: string };
        }
      | {
          __kind__: "err";
          err: ExportError;
        }
    > {
      await requireUserId(transport);
      const label = await scopeLabel(transport, target);
      if (label === null) {
        return { __kind__: "err", err: ExportErrorEnum.notFound };
      }
      const rows = await questionsInScope(transport, target);
      if (rows.length === 0) {
        return { __kind__: "err", err: ExportErrorEnum.empty };
      }
      return {
        __kind__: "ok",
        ok: exportFileFor(label, rows.map(questionOf), format),
      };
    },

    /**
     * Everything the account holds, as one JSON document.
     *
     * Mapped through the same view functions the app renders with, so the file
     * is the domain shape rather than a table dump: it stays readable after a
     * column rename, and Phase 4 can feed it back in without knowing the schema.
     * Secrets are absent because the only secret in the database is a digest.
     */
    async exportMyData(): Promise<UserDataExport> {
      await requireUserId(transport);
      const [
        classes,
        subjects,
        chapters,
        topics,
        questions,
        notes,
        noteShares,
        shares,
        links,
        settings,
      ] = await Promise.all([
        rpcRows(transport, "class_rows").then((rows) => rows.map(classSummary)),
        rpcRows(transport, "subject_rows").then((rows) =>
          rows.map(subjectSummary),
        ),
        rpcRows(transport, "chapter_rows").then((rows) =>
          rows.map(chapterSummary),
        ),
        rpcRows(transport, "topic_rows").then((rows) => rows.map(topicSummary)),
        transport
          .read("question", { order: { column: "id" } })
          .then((rows) => rows.map(questionOf)),
        transport
          .read("note", { order: { column: "updated_at", ascending: false } })
          .then((rows) => rows.map(noteOf)),
        transport
          .read("note_share")
          .then((rows) =>
            rows.map((row) => withoutFields(noteShareOf(row), ["token"])),
          ),
        transport
          .read("content_share")
          .then((rows) =>
            rows.map((row) => withoutFields(shareLinkOf(row), ["token"])),
          ),
        transport
          .read("link", { order: { column: "id" } })
          .then((rows) => rows.map(linkDetailOf)),
        transport
          .read("user_settings", { limit: 1 })
          .then((rows) => (rows[0] ? settingsOf(rows[0]) : null)),
      ]);

      const sessions = await Promise.all(
        (await transport.read("session", { order: { column: "id" } })).map(
          async (row) =>
            sessionViewOf(
              row,
              await transport.read("session_item", {
                eq: { session_id: String(row.id) },
                order: { column: "position" },
              }),
            ),
        ),
      );
      const results = await Promise.all(
        (await transport.read("result", { order: { column: "id" } })).map(
          async (row) =>
            sessionResultOf(
              row,
              await transport.read("result_item", {
                eq: { result_id: String(row.id) },
                order: { column: "position" },
              }),
            ),
        ),
      );
      const activity = (
        await transport.read("activity", {
          order: { column: "at", ascending: false },
        })
      ).map(activityItemOf);

      return {
        content: stringifyWithBigints(
          {
            exportedAt: new Date().toISOString(),
            classes,
            subjects,
            chapters,
            topics,
            questions,
            notes,
            noteShares,
            shares,
            links,
            sessions,
            results,
            settings,
            activity,
          },
          2,
        ),
        mimeType: "application/json",
        filename: "studydesk-export.json",
      };
    },
  };
}
