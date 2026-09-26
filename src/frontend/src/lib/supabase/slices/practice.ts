/**
 * Adapter slice: sessions, recorded results, and everything the dashboard reads.
 *
 * This is the slice where the database is not a storage engine but an arbiter.
 * `startSession` samples the pool, `submitAnswer` marks it right or wrong, and
 * `completeSession` writes the score and deletes the live row — all three inside
 * Postgres, because a client that can pick its own questions or report its own
 * grade is a client whose analytics mean nothing.
 *
 * So the slice is thin by design: hand the arguments over, translate the reply.
 * What would be a dozen lines of grading logic in the mock is one `rpc` call
 * here, and the mock's copy of that logic is not the reference implementation
 * anymore — `answer_is_correct` in the migration is.
 */
import type {
  ActivityItem,
  AnalyticsBreakdown,
  AttemptSummary,
  DashboardStats,
  Id,
  Result,
  Result_1,
  Result_5,
  SessionResult,
  SessionView,
  StartSessionRequest,
  SubmitAnswerRequest,
  backendInterface,
} from "@/backend";
import { idArg, jsonArg, requireUserId, rpcEnvelope, rpcRows } from "../common";
import {
  activityItemOf,
  analyticsBreakdownOf,
  answerFeedbackOf,
  attemptSummaryOf,
  dashboardStatsOf,
  errorCase,
  rpcOk,
  sessionError,
  sessionResultOf,
  sessionViewOf,
} from "../mapping";
import type { Row, SupabaseTransport } from "../transport";

/** A live session and its questions, in the one shape the player is served. */
async function readSession(
  transport: SupabaseTransport,
  sessionId: Id,
): Promise<SessionView | null> {
  const [row] = await transport.read("session", {
    eq: { id: idArg(sessionId) },
  });
  if (!row) {
    return null;
  }
  const items = await transport.read("session_item", {
    eq: { session_id: idArg(sessionId) },
    order: { column: "position" },
  });
  return sessionViewOf(row, items);
}

/** A recorded result, hidden when its topic or chapter has since been deleted. */
async function readResult(
  transport: SupabaseTransport,
  sessionId: Id,
): Promise<SessionResult | null> {
  const [row] = await transport.read("result", {
    eq: { session_id: idArg(sessionId) },
  });
  if (!row) {
    return null;
  }
  const scopeId = String(row.scope_id);
  const stillThere =
    row.scope_kind === "topic"
      ? (await transport.read("topic", { eq: { id: scopeId }, limit: 1 }))
          .length > 0
      : (await transport.read("chapter", { eq: { id: scopeId }, limit: 1 }))
          .length > 0;
  if (!stillThere) {
    return null;
  }
  const items = await transport.read("result_item", {
    eq: { result_id: String(row.id) },
    order: { column: "position" },
  });
  return sessionResultOf(row, items);
}

export function createPracticeSlice(
  transport: SupabaseTransport,
): Pick<
  backendInterface,
  | "startSession"
  | "getSession"
  | "submitAnswer"
  | "completeSession"
  | "getSessionResult"
  | "getAttemptHistory"
  | "getAnalyticsBreakdown"
  | "getDashboardStats"
  | "getRecentActivity"
> {
  return {
    async startSession(request: StartSessionRequest): Promise<Result_1> {
      await requireUserId(transport);
      const scope =
        request.scope.__kind__ === "topic"
          ? { kind: "topic", id: idArg(request.scope.topic) }
          : { kind: "chapter", id: idArg(request.scope.chapter) };
      const payload = await rpcEnvelope(transport, "start_session", {
        p_mode: request.mode,
        p_scope_kind: scope.kind,
        p_scope_id: scope.id,
        p_question_count:
          request.questionCount === undefined
            ? null
            : idArg(request.questionCount),
        p_duration_seconds:
          request.durationSeconds === undefined
            ? null
            : idArg(request.durationSeconds),
      });
      if ("err" in payload && payload.err !== undefined) {
        return { __kind__: "err", err: sessionError(payload.err) };
      }
      const sessionId = rpcOk<bigint | number>(payload);
      const session = await readSession(transport, BigInt(sessionId));
      if (!session) {
        // start_session committed and the row is already gone, which only
        // happens if something deleted it in between — report that honestly
        // rather than handing back an empty session.
        return {
          __kind__: "err",
          err: { __kind__: "notFound", notFound: null },
        };
      }
      return { __kind__: "ok", ok: session };
    },

    async getSession(sessionId: Id): Promise<SessionView | null> {
      await requireUserId(transport);
      return readSession(transport, sessionId);
    },

    async submitAnswer(request: SubmitAnswerRequest): Promise<Result> {
      await requireUserId(transport);
      const payload = await rpcEnvelope(transport, "submit_answer", {
        p_session_id: idArg(request.sessionId),
        p_question_id: idArg(request.questionId),
        p_submitted: jsonArg(request.answer),
      });
      if ("err" in payload && payload.err !== undefined) {
        return { __kind__: "err", err: sessionError(payload.err) };
      }
      return { __kind__: "ok", ok: answerFeedbackOf(rpcOk<Row>(payload)) };
    },

    async completeSession(sessionId: Id): Promise<Result_5> {
      await requireUserId(transport);
      const payload = await rpcEnvelope(transport, "complete_session", {
        p_session_id: idArg(sessionId),
      });
      if ("err" in payload && payload.err !== undefined) {
        const { kind } = errorCase(payload.err);
        return {
          __kind__: "err",
          err:
            kind === "invalidInput"
              ? {
                  __kind__: "invalidInput",
                  invalidInput: "session cannot be completed",
                }
              : { __kind__: "notFound", notFound: null },
        };
      }
      // The reply names the session id, which is what `getSessionResult` takes,
      // so the result the caller sees now and the one the history page finds
      // later are read by the same code path.
      const result = await readResult(transport, sessionId);
      if (!result) {
        return {
          __kind__: "err",
          err: { __kind__: "notFound", notFound: null },
        };
      }
      return { __kind__: "ok", ok: result };
    },

    async getSessionResult(sessionId: Id): Promise<SessionResult | null> {
      await requireUserId(transport);
      return readResult(transport, sessionId);
    },

    async getAttemptHistory(): Promise<AttemptSummary[]> {
      await requireUserId(transport);
      const rows = await rpcRows(transport, "attempt_history");
      return rows.map(attemptSummaryOf);
    },

    async getAnalyticsBreakdown(): Promise<AnalyticsBreakdown> {
      await requireUserId(transport);
      return analyticsBreakdownOf(
        await rpcEnvelope(transport, "analytics_breakdown"),
      );
    },

    async getDashboardStats(): Promise<DashboardStats> {
      await requireUserId(transport);
      return dashboardStatsOf(await rpcEnvelope(transport, "dashboard_stats"));
    },

    async getRecentActivity(limit: Id): Promise<ActivityItem[]> {
      await requireUserId(transport);
      const wanted = Number(limit);
      if (wanted <= 0) {
        return [];
      }
      const rows = await transport.read("activity", {
        order: { column: "at", ascending: false },
        limit: wanted,
      });
      return rows.map(activityItemOf);
    },
  };
}
