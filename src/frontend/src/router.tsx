import { LoadingState } from "@/components/common/LoadingState";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { useBackend } from "@/hooks/useBackend";
import AiStudio from "@/pages/AiStudio";
import Analytics from "@/pages/Analytics";
import AuthPage from "@/pages/AuthPage";
import ChapterDetail from "@/pages/ChapterDetail";
import ClassDetail from "@/pages/ClassDetail";
import Classes from "@/pages/Classes";
import Dashboard from "@/pages/Dashboard";
import ExportPage from "@/pages/ExportPage";
import Landing from "@/pages/Landing";
import ManageLink from "@/pages/ManageLink";
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
import TimedTest from "@/pages/TimedTest";
import TopicDetail from "@/pages/TopicDetail";
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from "@tanstack/react-router";

/* -------------------------------------------------------------------------- */
/* Route tree                                                                  */
/* -------------------------------------------------------------------------- */

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
});
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  component: () => <AuthPage mode="register" />,
});
const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email",
  component: () => <AuthPage mode="verify" />,
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

const shareRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/share",
  component: SharePage,
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
