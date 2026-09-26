/**
 * Adapter slice: settings, the caller's role, and the canister's own plumbing.
 *
 * Two kinds of method live here.
 *
 * `getMySettings` and `saveMySettings` are real product surface. The mock
 * validated a profile in TypeScript and would have happily accepted a row that
 * contradicted its own limits; here the same checks run before the request — so
 * the error text stays the one the form shows — and the database's `check`
 * constraints stand behind them as the rule that cannot be routed around.
 *
 * The rest are methods the Motoko canister has because it is a canister:
 * access-control bootstrapping, an Internet Identity handshake of its own, a
 * `schema`/`execute` introspection pair, and the AI key that the browser now
 * keeps. Nothing in the app calls them — they exist so this object can be typed
 * `satisfies backendInterface`, which is what makes `pnpm typecheck` a
 * completeness proof for all 66 data methods. They are implemented as no-ops or
 * as explicit refusals, never as something that pretends to have worked.
 */
import type {
  AiConfigStatus,
  DraftQuestion,
  GenerateRequest,
  Id,
  Question,
  Result_2,
  Result_6,
  Result__1,
  SettingsError,
  UserSettingsView,
  backendInterface,
} from "@/backend";
import { UserRole } from "@/backend";
import type { Principal } from "@icp-sdk/core/principal";
import {
  idArg,
  jsonArg,
  optionalLabel,
  requireUserId,
  rpcRows,
} from "../common";
import { questionOf, settingsOf } from "../mapping";
import type { SupabaseTransport } from "../transport";

const MAX_DISPLAY_NAME = 80;
const MAX_STUDY_GOAL = 280;
const MAX_DAILY_TARGET = 1000;
const APPEARANCES: string[] = ["light", "dark", "frosted"];

/** The same refusal text the mock produced, so the settings form is unchanged. */
function settingsProblem(
  displayName: string,
  studyGoal: string,
  dailyTarget: number,
  appearance: string,
): string | null {
  if (displayName.length === 0) {
    return "Display name is required";
  }
  if (displayName.length > MAX_DISPLAY_NAME) {
    return `Display name must be at most ${String(MAX_DISPLAY_NAME)} characters`;
  }
  if (studyGoal.length > MAX_STUDY_GOAL) {
    return `Study goal must be at most ${String(MAX_STUDY_GOAL)} characters`;
  }
  if (dailyTarget === 0) {
    return "Daily target must be at least 1";
  }
  if (dailyTarget > MAX_DAILY_TARGET) {
    return `Daily target must be at most ${String(MAX_DAILY_TARGET)}`;
  }
  if (!APPEARANCES.includes(appearance)) {
    return "Appearance must be one of: light, dark, frosted";
  }
  return null;
}

const invalid = (message: string): { __kind__: "err"; err: SettingsError } => ({
  __kind__: "err",
  err: { __kind__: "invalidInput", invalidInput: message },
});

export function createSystemSlice(
  transport: SupabaseTransport,
): Pick<
  backendInterface,
  | "getMySettings"
  | "saveMySettings"
  | "getCallerUserRole"
  | "isCallerAdmin"
  | "assignCallerUserRole"
  | "_initialize_access_control"
  | "_internet_identity_sign_in_start"
  | "_internet_identity_sign_in_finish"
  | "getApiDoc"
  | "schema"
  | "execute"
  | "getAiConfig"
  | "saveAiKey"
  | "removeAiKey"
  | "generateDrafts"
  | "acceptDraft"
> {
  return {
    /* --------------------------------- settings --------------------------------- */

    async getMySettings(): Promise<UserSettingsView | null> {
      const id = await transport.userId();
      if (!id) {
        return null;
      }
      const [row] = await transport.read("user_settings", {
        eq: { owner_id: id },
      });
      return row ? settingsOf(row) : null;
    },

    /**
     * One row keyed by the caller, written with `upsert`.
     *
     * `on_conflict: owner_id` makes first save and every later save the same
     * request, which removes the mock's "does the row exist yet" branch — and
     * with it the race where two tabs both open Settings for the first time.
     */
    async saveMySettings(
      displayName: string,
      studyGoal: string,
      dailyTarget: Id,
      appearance: string,
    ): Promise<
      | { __kind__: "ok"; ok: UserSettingsView }
      | { __kind__: "err"; err: SettingsError }
    > {
      const id = await requireUserId(transport);
      const name = displayName.trim();
      const goal = studyGoal.trim();
      const target = Number(idArg(dailyTarget));
      const theme = appearance.trim().toLowerCase();
      const problem = settingsProblem(name, goal, target, theme);
      if (problem) {
        return invalid(problem);
      }
      const [row] = await transport.write("user_settings", {
        upsert: {
          owner_id: id,
          display_name: name,
          study_goal: goal,
          daily_target: target,
          appearance: theme,
        },
        onConflict: "owner_id",
      });
      if (!row) {
        throw new Error("The settings row was not written");
      }
      return { __kind__: "ok", ok: settingsOf(row) };
    },

    /* ------------------------------ caller identity ----------------------------- */

    async getCallerUserRole(): Promise<UserRole> {
      return (await transport.userId()) ? UserRole.user : UserRole.guest;
    },

    /**
     * Roles are a canister concept, and Postgres has no room for it yet.
     *
     * There is no admin screen in the app, so this answers `false` rather than
     * inventing a privileged account that nothing audits. The day an admin UI
     * exists, the answer comes from a policy on a `role` column — not from this
     * function, which is the wrong place to keep it.
     */
    async isCallerAdmin(): Promise<boolean> {
      return false;
    },

    async assignCallerUserRole(
      _user: Principal,
      _role: UserRole,
    ): Promise<void> {},

    /* ---------------------------- canister-only internals ---------------------------- */

    async _initialize_access_control(): Promise<void> {},

    async _internet_identity_sign_in_start(): Promise<Uint8Array> {
      return new Uint8Array(0);
    },

    /**
     * Sign-in on this backend is Supabase Auth's, not the canister's.
     *
     * A Motoko `Result_6` has no "wrong deployment" case, so the refusal is an
     * exception with the reason in it — which every caller already treats as a
     * failed request, and which beats returning `ok` for a handshake that did
     * not happen.
     */
    async _internet_identity_sign_in_finish(): Promise<Result_6> {
      throw new Error(
        "Internet Identity belongs to the canister. This build signs in through Supabase Auth.",
      );
    },

    async getApiDoc(): Promise<string> {
      return "# StudyForge Supabase backend\n\nData lives in Postgres behind row level security; the API is the PostgREST surface plus the functions in supabase/migrations/0001_init.sql.\n";
    },

    async schema(): Promise<string> {
      return JSON.stringify({
        storage: "supabase-postgres",
        rls: "owner-scoped",
        version: 1,
      });
    },

    /** No ad-hoc query endpoint. `anon` should not have been able to read the schema, and neither should a signed-in page. */
    async execute(): Promise<Result__1> {
      throw new Error(
        "Direct query execution is not available on this backend.",
      );
    },

    /* ------------------------------------ AI ------------------------------------ */

    /**
     * Extraction runs in the browser (`src/lib/ai/`), against the reviewer's own
     * key held on that device. Nothing in this app puts a provider key in a
     * database, so the honest answer is "no key is stored here".
     */
    async getAiConfig(): Promise<AiConfigStatus> {
      return { hasPersonalKey: false };
    },

    async saveAiKey(key: string): Promise<AiConfigStatus> {
      if (key.trim().length === 0) {
        throw new Error("API key must not be empty");
      }
      throw new Error(
        "This backend stores no provider keys. Add the key in AI Studio, on this device.",
      );
    },

    async removeAiKey(): Promise<AiConfigStatus> {
      return { hasPersonalKey: false };
    },

    async generateDrafts(_request: GenerateRequest): Promise<Result_2> {
      return {
        __kind__: "err",
        err: { __kind__: "notConfigured", notConfigured: null },
      };
    },

    /**
     * The one AI method that is a real write: an approved draft is just a
     * question, and the review queue's job is finished by the time this runs.
     */
    async acceptDraft(
      topicId: Id,
      draft: DraftQuestion,
    ): Promise<Question | null> {
      await requireUserId(transport);
      const topics = await rpcRows(transport, "topic_rows", {
        p_id: idArg(topicId),
      });
      if (topics.length === 0) {
        return null;
      }
      const [row] = await transport.write("question", {
        insert: {
          topic_id: idArg(topicId),
          prompt: draft.prompt,
          question_type: draft.questionType,
          answer: jsonArg(draft.answer),
          explanation: optionalLabel(draft.explanation) ?? null,
        },
      });
      return row ? questionOf(row) : null;
    },
  };
}
