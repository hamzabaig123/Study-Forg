import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { StorageHealthBanner } from "@/components/layout/StorageHealthBanner";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReminderScheduler } from "@/hooks/useReminders";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

/**
 * Signed-in shell: sticky header, collapsible sidebar navigation tree, and the
 * routed page body. On mobile the sidebar becomes an overlay drawer.
 */
export function AppLayout() {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Daily email/notification digest, checked once a minute while signed in.
  useReminderScheduler();
  // Re-keying the page body on every navigation replays its entrance, which
  // is the whole page-transition: a short rise the route content makes as it
  // arrives. motion-safe keeps it off for visitors who ask for less motion.
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SkipLink />
      <Header
        showSidebarToggle={isMobile}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      />
      <div className="flex flex-1">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
          data-ocid="app.main"
        >
          <div className="mx-auto w-full max-w-6xl">
            <StorageHealthBanner />
            <div key={pathname} className="motion-safe:animate-fade-up">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
      <footer className="pb-safe border-t border-border bg-card px-4 py-5 sm:px-6">
        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} StudyForge
        </p>
      </footer>
    </div>
  );
}

/**
 * The first tab stop on a signed-in page, aimed past the chrome at the content.
 *
 * Header and sidebar come before the page body in the DOM, so without this a
 * keyboard visitor tabs through every nav control before reaching anything they
 * came for. It is hidden until focused — a visible link would sit above the
 * header on every page — and `fixed` once it is, because an element that only
 * becomes visible when focused must not be clipped by the container it is in.
 */
function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground"
      data-ocid="app.skip_link"
    >
      Skip to content
    </a>
  );
}

/**
 * Public shell for routes that must work without signing in — the QR
 * generator, the secret manage page, the scan redirect, and shared notes.
 * Same header and footer chrome as the signed-in shell, but no sidebar and no
 * authentication guard.
 *
 * Renders `children` when provided (pages that wrap their own content), and
 * falls back to the routed `<Outlet />` when used as a layout route.
 */
export function PublicLayout({ children }: { children?: ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SkipLink />
      <Header />
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 flex-1 px-4 py-8 outline-none sm:px-6 lg:px-8 lg:py-12"
        data-ocid="public.main"
      >
        <div
          key={pathname}
          className="mx-auto w-full max-w-6xl motion-safe:animate-fade-up"
        >
          {children ?? <Outlet />}
        </div>
      </main>
      <footer className="pb-safe border-t border-border bg-card px-4 py-5 sm:px-6">
        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} StudyForge
        </p>
      </footer>
    </div>
  );
}
