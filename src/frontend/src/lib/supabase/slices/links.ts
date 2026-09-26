/**
 * Adapter slice: the QR short-link surface.
 *
 * This is the only domain the app exposes to logged-out visitors, and it is the
 * reason the migration has any `security definer` functions at all: `anon` holds
 * no table privileges, so creating a link, resolving a code and managing a link
 * by its edit token each have to be a function that checks its own authority.
 *
 * Authority here is the edit token, not the session. A printed QR code cannot be
 * re-issued when somebody signs in as a different account, so every method in
 * this slice takes the token the /manage page arrived with, hashes it, and lets
 * the digest find the row. That is also why `link.edit_token_hash` is the only
 * token in the schema with no plaintext twin: it is a write key that nothing ever
 * needs to read back.
 */
import type {
  AbuseError,
  CreateLinkError,
  CreatedLink,
  DeviceType,
  EditToken,
  LinkDetail,
  ManageLinkError,
  ResolveResult,
  ScanStats,
  ShortCode,
  backendInterface,
} from "@/backend";
import { UnavailableReason } from "@/backend";
import { hashToken, logActivity, requireUserId, rpcEnvelope } from "../common";
import {
  abuseError,
  createLinkError,
  createdLinkOf,
  errorCase,
  linkDetailOf,
  manageLinkError,
  rpcOk,
  scanStatsOf,
  toText,
} from "../mapping";
import { newEditToken, newShortCode } from "../tokens";
import type { Row, SupabaseTransport } from "../transport";

/**
 * A code collides with one already issued roughly once in 35 billion draws, so
 * this loop is not a workaround for a busy system. It exists because a collision
 * is a retry and not an error, and because `err` from `create_link` names the
 * difference instead of collapsing it into the one `CreateLinkError` case that
 * would be a lie.
 */
const CODE_RETRIES = 3;

/** The four reasons a code does not redirect, named by `resolve_link`. */
function unavailableReason(text: string): UnavailableReason {
  if (text === UnavailableReason.deleted) {
    return UnavailableReason.deleted;
  }
  if (text === UnavailableReason.paused) {
    return UnavailableReason.paused;
  }
  if (text === UnavailableReason.rateLimited) {
    return UnavailableReason.rateLimited;
  }
  return UnavailableReason.notFound;
}

export function createLinksSlice(
  transport: SupabaseTransport,
): Pick<
  backendInterface,
  | "createLink"
  | "resolveCode"
  | "getLinkByToken"
  | "getScanStats"
  | "setPaused"
  | "updateTarget"
  | "deleteLink"
  | "reportAbuse"
> {
  return {
    async createLink(
      targetUrl: string,
    ): Promise<
      | { __kind__: "ok"; ok: CreatedLink }
      | { __kind__: "err"; err: CreateLinkError }
    > {
      for (let attempt = 0; attempt < CODE_RETRIES; attempt += 1) {
        const code = newShortCode();
        const editToken = newEditToken();
        const payload = await rpcEnvelope(transport, "create_link", {
          p_target_url: targetUrl,
          p_code: code,
          p_edit_token: editToken,
        });
        if ("err" in payload && payload.err !== undefined) {
          const { kind } = errorCase(payload.err);
          if (kind === "invalidUrl") {
            return { __kind__: "err", err: createLinkError(payload.err) };
          }
          if (
            kind !== "codeTaken" &&
            kind !== "badCode" &&
            kind !== "badToken"
          ) {
            return {
              __kind__: "err",
              err: { __kind__: "rateLimited", rateLimited: null },
            };
          }
          continue;
        }
        const ok = createdLinkOf(rpcOk<Row>(payload));
        // The QR generator is open to visitors, and a visitor has no id to put on
        // a feed row. The link is already created, so this is skipped rather than
        // allowed to fail a request that worked.
        if (await transport.userId()) {
          await logActivity(
            transport,
            "link",
            `Created the short link ${ok.shortUrl}`,
          );
        }
        return { __kind__: "ok", ok };
      }
      return {
        __kind__: "err",
        err: { __kind__: "rateLimited", rateLimited: null },
      };
    },

    async resolveCode(
      code: ShortCode,
      device: DeviceType,
      country: string | null,
    ): Promise<ResolveResult> {
      const payload = await rpcEnvelope(transport, "resolve_link", {
        p_code: code,
        p_device: device,
        p_country: country ?? "",
      });
      if ("unavailable" in payload) {
        return {
          __kind__: "unavailable",
          unavailable: unavailableReason(toText(payload.unavailable)),
        };
      }
      return {
        __kind__: "redirect",
        redirect: { targetUrl: toText(payload.targetUrl) },
      };
    },

    async getLinkByToken(editToken: EditToken): Promise<LinkDetail | null> {
      const payload = await transport.rpc("link_detail_for_token", {
        p_token_hash: await hashToken(editToken),
      });
      if (!payload || typeof payload !== "object") {
        return null;
      }
      return linkDetailOf(payload as Row);
    },

    async getScanStats(editToken: EditToken): Promise<ScanStats | null> {
      const payload = await transport.rpc("link_scan_stats_for_token", {
        p_token_hash: await hashToken(editToken),
      });
      if (!payload || typeof payload !== "object") {
        return null;
      }
      return scanStatsOf(payload as Row);
    },

    async setPaused(
      editToken: EditToken,
      paused: boolean,
    ): Promise<
      | { __kind__: "ok"; ok: LinkDetail }
      | { __kind__: "err"; err: ManageLinkError }
    > {
      const payload = await rpcEnvelope(transport, "link_set_paused", {
        p_token_hash: await hashToken(editToken),
        p_paused: paused,
      });
      if ("err" in payload && payload.err !== undefined) {
        return { __kind__: "err", err: manageLinkError(payload.err) };
      }
      return { __kind__: "ok", ok: linkDetailOf(rpcOk<Row>(payload)) };
    },

    async updateTarget(
      editToken: EditToken,
      targetUrl: string,
    ): Promise<
      | { __kind__: "ok"; ok: LinkDetail }
      | { __kind__: "err"; err: ManageLinkError }
    > {
      const payload = await rpcEnvelope(transport, "link_update_target", {
        p_token_hash: await hashToken(editToken),
        p_target_url: targetUrl,
      });
      if ("err" in payload && payload.err !== undefined) {
        return { __kind__: "err", err: manageLinkError(payload.err) };
      }
      return { __kind__: "ok", ok: linkDetailOf(rpcOk<Row>(payload)) };
    },

    async deleteLink(
      editToken: EditToken,
    ): Promise<
      { __kind__: "ok"; ok: null } | { __kind__: "err"; err: ManageLinkError }
    > {
      const payload = await rpcEnvelope(transport, "link_delete", {
        p_token_hash: await hashToken(editToken),
      });
      if ("err" in payload && payload.err !== undefined) {
        return { __kind__: "err", err: manageLinkError(payload.err) };
      }
      return { __kind__: "ok", ok: null };
    },

    async reportAbuse(
      code: ShortCode,
      reason: string,
    ): Promise<
      { __kind__: "ok"; ok: null } | { __kind__: "err"; err: AbuseError }
    > {
      const payload = await rpcEnvelope(transport, "report_link_abuse", {
        p_code: code,
        p_reason: reason,
      });
      if ("err" in payload && payload.err !== undefined) {
        return { __kind__: "err", err: abuseError(payload.err) };
      }
      return { __kind__: "ok", ok: null };
    },
  };
}
