import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  Download,
  LayoutDashboard,
  Library,
  ListChecks,
  NotebookPen,
  QrCode,
  Settings,
  Share2,
  Sparkles,
  X,
} from "lucide-react";

interface NavEntry {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
}

const PRIMARY_NAV: NavEntry[] = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, exact: true },
  { label: "Classes", to: "/classes", icon: Library },
  { label: "Build a test", to: "/test-builder", icon: ListChecks },
  { label: "Notes", to: "/notes", icon: NotebookPen },
  { label: "AI Studio", to: "/ai-studio", icon: Sparkles },
  { label: "Analytics", to: "/analytics", icon: BarChart3 },
];

const SECONDARY_NAV: NavEntry[] = [
  { label: "QR Generator", to: "/qr", icon: QrCode },
  { label: "Share", to: "/share", icon: Share2 },
  { label: "Export", to: "/export", icon: Download },
  { label: "Settings", to: "/settings", icon: Settings },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

function NavLink({
  entry,
  onNavigate,
}: { entry: NavEntry; onNavigate: () => void }) {
  const Icon = entry.icon;
  return (
    <li>
      <Link
        to={entry.to}
        activeOptions={{ exact: entry.exact ?? false }}
        onClick={onNavigate}
        className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-smooth hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        activeProps={{
          className:
            "bg-sidebar-accent text-sidebar-accent-foreground shadow-inset-soft",
        }}
        data-ocid={`nav.${entry.to.replace(/^\//, "").replace(/\//g, ".")}_link`}
      >
        <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
        <span className="truncate">{entry.label}</span>
      </Link>
    </li>
  );
}

export function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          data-ocid="nav.sidebar_backdrop"
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[86vw] flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 ease-out lg:sticky lg:top-16 lg:z-0 lg:h-[calc(100dvh-4rem)] lg:w-64 lg:max-w-none lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Primary navigation"
        data-ocid="nav.sidebar"
      >
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4 lg:hidden">
          <span className="font-display text-base font-semibold">
            Navigation
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close navigation"
            data-ocid="nav.sidebar_close_button"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/50">
            Study
          </p>
          <ul className="space-y-1">
            {PRIMARY_NAV.map((entry) => (
              <NavLink key={entry.to} entry={entry} onNavigate={onClose} />
            ))}
          </ul>

          <p className="px-3 pb-2 pt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/50">
            Distribute
          </p>
          <ul className="space-y-1">
            {SECONDARY_NAV.map((entry) => (
              <NavLink key={entry.to} entry={entry} onNavigate={onClose} />
            ))}
          </ul>
        </nav>

        <div className="border-t border-sidebar-border p-4 pb-safe">
          <div className="flex items-start gap-2.5 rounded-md bg-sidebar-accent/60 p-3">
            <BookOpen
              className="mt-0.5 h-4 w-4 shrink-0 text-sidebar-primary"
              aria-hidden="true"
            />
            <p className="text-xs leading-relaxed text-sidebar-foreground/70">
              Build classes, subjects, chapters, and topics — then drill them
              with practice and timed tests.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
