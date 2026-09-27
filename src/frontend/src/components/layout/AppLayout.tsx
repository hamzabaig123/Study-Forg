import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { StorageHealthBanner } from "@/components/layout/StorageHealthBanner";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReminderScheduler } from "@/hooks/useReminders";
import { Outlet } from "@tanstack/react-router";
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

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <Header
        showSidebarToggle={isMobile}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      />
      <div className="flex flex-1">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main
          className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
          data-ocid="app.main"
        >
          <div className="mx-auto w-full max-w-6xl">
            <StorageHealthBanner />
            <Outlet />
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
 * Public shell for routes that must work without signing in — the QR
 * generator, the secret manage page, the scan redirect, and shared notes.
 * Same header and footer chrome as the signed-in shell, but no sidebar and no
 * authentication guard.
 *
 * Renders `children` when provided (pages that wrap their own content), and
 * falls back to the routed `<Outlet />` when used as a layout route.
 */
export function PublicLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <Header />
      <main
        className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-12"
        data-ocid="public.main"
      >
        <div className="mx-auto w-full max-w-6xl">{children ?? <Outlet />}</div>
      </main>
      <footer className="pb-safe border-t border-border bg-card px-4 py-5 sm:px-6">
        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} StudyForge
        </p>
      </footer>
    </div>
  );
}
