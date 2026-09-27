import { LoadingState } from "@/components/common/LoadingState";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { useBackend } from "@/hooks/useBackend";
import AiStudio from "@/pages/AiStudio";
import AuthPage from "@/pages/AuthPage";
import ChapterDetail from "@/pages/ChapterDetail";
import ClassDetail from "@/pages/ClassDetail";
import Classes from "@/pages/Classes";
import CustomResults from "@/pages/CustomResults";
import CustomTest from "@/pages/CustomTest";
import Dashboard from "@/pages/Dashboard";
import ExportPage from "@/pages/ExportPage";
import Landing from "@/pages/Landing";
import NoteDetail from "@/pages/NoteDetail";
import Notes from "@/pages/Notes";
import PracticeSession from "@/pages/PracticeSession";
import QrGenerator from "@/pages/QrGenerator";
import ScanRedirect from "@/pages/ScanRedirect";
import SessionResults from "@/pages/SessionResults";
import SettingsPage from "@/pages/SettingsPage";
import SharePage from "@/pages/SharePage";
import SharedNoteView from "@/pages/SharedNoteView";
import SharedView from "@/pages/SharedView";
import SubjectDetail from "@/pages/SubjectDetail";
import TestBuilder from "@/pages/TestBuilder";
import TimedTest from "@/pages/TimedTest";
import TopicDetail from "@/pages/TopicDetail";
import {
  Outlet,
  type RouteComponent,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from "@tanstack/react-router";
import { type ComponentType, Suspense, lazy } from "react";

/* -------------------------------------------------------------------------- */
/* Route tree                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A page that is fetched the first time its route is entered.
 *
 * Analytics and the link manager are the only screens that draw charts, and
 * `recharts` plus its scale helpers are the single largest thing in the entry
 * chunk — a visitor who never opens either page was downloading them on every
 * cold load. The fallback is the same `LoadingState` the rest of the app uses,
 * so a slow chunk reads as the app's own spinner rather than a blank route.
 */
function lazyPage(
  loader: () => Promise<{ default: ComponentType }>,
  label: string,
): RouteComponent {
  // RouteComponent, not React's ComponentType: the router's `component` slot
  // accepts a bare function signature only, and the union's class half fails
  // it. The returned page is a function, so the annotation just names it.
  const Page = lazy(loader);
  return function LazyPage() {
    return (
      <Suspense fallback={<LoadingState label={label} />}>
        <Page />
      </Suspense>
    );
  };
}

const Analytics = lazyPage(
  () => import("@/pages/Analytics"),
  "Loading your analytics…",
);
const ManageLink = lazyPage(
  () => import("@/pages/ManageLink"),
  "Loading the link…",
);

const rootRoute = createRootRoute({ component: RootRoute });

/**
 * Public pages that answer from backend data, held back until an actor exists.
 *
 * A query with no actor is disabled rather than pending, which reads as "loaded,
 * nothing found" — so a shared link would flash "this note isn't available" and
 * then show the note. The signed-in routes are covered by `RequireAuth`, which
 * can do it after sending a signed-out visitor to the login screen.
 */
const BACKEND_GATED_PREFIXES = ["/shared", "/manage", "/r", "/qr"];

/**
 * `?email=` on the sign-in and verification screens.
 *
 * TanStack parses `?topic=6` as the *number* 6, so a validator written as
 * `typeof x === "string"` silently deletes the param; these addresses are typed
 * by a person and accepted either way.
 */
function emailSearch(search: Record<string, unknown>): { email?: string } {
  const raw =
    typeof search.email === "string" || typeof search.email === "number"
      ? String(search.email).trim()
      : "";
  return { email: raw || undefined };
}

function RootRoute() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { actor } = useBackend();

  if (
    !actor &&
    BACKEND_GATED_PREFIXES.includes(`/${pathname.split("/")[1] ?? ""}`)
  ) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <LoadingState label="Loading your workspace…" />
      </main>
    );
  }
  return <Outlet />;
}

/** Public: marketing landing page. */
const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Landing,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: () => <AuthPage mode="login" />,
  validateSearch: emailSearch,
});
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  component: () => <AuthPage mode="register" />,
});
/**
 * The verification screen, reachable with or without a session.
 *
 * A sign-up that requires confirmation leaves the browser signed out by design,
 * so the address has to travel in the URL — otherwise the one screen that can
 * re-send the link has nothing to send it to, and the new account is stranded
 * between a login that answers "Email not confirmed" and a dashboard it cannot
 * open.
 */
const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email",
  component: () => <AuthPage mode="verify" />,
  validateSearch: emailSearch,
});

/**
 * Ask for a password reset link. Public, and reachable from the sign-in card.
 *
 * The address travels in `?email=` for the same reason the verification screen
 * takes it: a visitor who has forgotten their password is by definition signed
 * out, so there is no session to read it from.
 */
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: () => <AuthPage mode="forgot" />,
  validateSearch: emailSearch,
});

/**
 * Where the reset link lands, and where the new password is chosen.
 *
 * This is the `redirectTo` the session store sends with the request, so the two
 * have to agree. Opening it without the link gets a page that says so: the
 * recovery session is what authorises the change, and it arrives with the link.
 */
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  component: () => <AuthPage mode="reset" />,
});

/** Public: read-only shared content, reachable without signing in. */
const sharedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/shared/$token",
  component: SharedView,
});

/** Public: dynamic QR generator. No sign-in required. */
const qrRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/qr",
  component: QrGenerator,
});

/** Public: link management, reachable only through the secret edit link. */
const manageLinkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/manage/$token",
  component: ManageLink,
});

/** Public: short-code scan redirect. */
const scanRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/r/$code",
  component: ScanRedirect,
});

/** Public: read-only shared note, reachable without signing in. */
const sharedNoteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/shared/note/$token",
  component: SharedNoteView,
});

/**
 * Signed-in shell. Every child route inherits the header + sidebar layout and
 * the authentication guard, which is enforced inside `RequireAuth` so the
 * Internet Identity hook runs during a component render.
 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: RequireAuth,
});

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/dashboard",
  component: Dashboard,
});

const classesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/classes",
  component: Classes,
});

const classDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/classes/$classId",
  component: ClassDetail,
});

const subjectDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/subjects/$subjectId",
  component: SubjectDetail,
});

const chapterDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/chapters/$chapterId",
  component: ChapterDetail,
});

const topicDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/topics/$topicId",
  component: TopicDetail,
});

/**
 * AI Studio. `?topic=<id>` pre-selects where extracted drafts are saved, which
 * is how the topic pages hand work over to this page.
 */
const aiStudioRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/ai-studio",
  component: AiStudio,
  // The router parses `?topic=6` as a number, so the id is widened here rather
  // than dropped by a string check.
  validateSearch: (search: Record<string, unknown>): { topic?: string } => {
    const topic =
      typeof search.topic === "string" || typeof search.topic === "number"
        ? String(search.topic).trim()
        : "";
    return { topic: topic || undefined };
  },
});

const practiceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/practice/$sessionId",
  component: PracticeSession,
});

const timedTestRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/test/$sessionId",
  component: TimedTest,
});

/**
 * The test builder. `?topic=` / `?chapter=` pre-select a source, which is how
 * the topic and chapter pages hand over to this page. As with the AI Studio
 * route, the router parses `?topic=6` as a number, so ids are widened here.
 */
const testBuilderRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/test-builder",
  component: TestBuilder,
  validateSearch: (
    search: Record<string, unknown>,
  ): { topic?: string; chapter?: string; mode?: string } => {
    const widen = (value: unknown): string | undefined => {
      const text =
        typeof value === "string" || typeof value === "number"
          ? String(value).trim()
          : "";
      return text || undefined;
    };
    const mode = widen(search.mode);
    return {
      topic: widen(search.topic),
      chapter: widen(search.chapter),
      mode: mode === "practice" || mode === "timed" ? mode : undefined,
    };
  },
});

/** Runs a locally assembled test (practice or timed). */
const customTestRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/custom-test/$sessionId",
  component: CustomTest,
});

/** Results for a locally assembled test. */
const customResultsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/custom-results/$sessionId",
  component: CustomResults,
});

const resultsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/results/$sessionId",
  component: SessionResults,
});

const analyticsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/analytics",
  component: Analytics,
});

/**
 * Share. `?topic=` / `?chapter=` pre-select the cascade, which is how the
 * topic and chapter pages hand over without the user re-picking everything.
 */
const shareRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/share",
  component: SharePage,
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    topic?: string;
    chapter?: string;
  } => {
    const widen = (value: unknown): string | undefined => {
      const text =
        typeof value === "string" || typeof value === "number"
          ? String(value).trim()
          : "";
      return text || undefined;
    };
    return { topic: widen(search.topic), chapter: widen(search.chapter) };
  },
});

const exportRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/export",
  component: ExportPage,
});

/** Signed-in: the private notes workspace. */
const notesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/notes",
  component: Notes,
});

const noteDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/notes/$noteId",
  component: NoteDetail,
});

/** Signed-in: account, appearance, privacy, and security settings. */
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  landingRoute,
  loginRoute,
  registerRoute,
  verifyEmailRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  sharedRoute,
  qrRoute,
  manageLinkRoute,
  scanRedirectRoute,
  sharedNoteRoute,
  appRoute.addChildren([
    dashboardRoute,
    classesRoute,
    classDetailRoute,
    subjectDetailRoute,
    chapterDetailRoute,
    topicDetailRoute,
    aiStudioRoute,
    practiceRoute,
    timedTestRoute,
    testBuilderRoute,
    customTestRoute,
    customResultsRoute,
    resultsRoute,
    analyticsRoute,
    shareRoute,
    exportRoute,
    notesRoute,
    noteDetailRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
