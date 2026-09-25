import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { shortPrincipal } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { Flame, LogIn, LogOut, Menu, UserRound } from "lucide-react";

interface HeaderProps {
  onToggleSidebar?: () => void;
  showSidebarToggle?: boolean;
  className?: string;
}

export function Header({
  onToggleSidebar,
  showSidebarToggle = false,
  className,
}: HeaderProps) {
  const { isAuthenticated, displayName, principal, account, signOut } =
    useAuth();
  // Internet Identity sign-in has no profile record, so the principal is the
  // only thing worth showing.
  const handle = displayName ?? (principal ? shortPrincipal(principal) : null);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80",
        className,
      )}
      data-ocid="app.header"
    >
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        {showSidebarToggle ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onToggleSidebar}
            aria-label="Open navigation"
            data-ocid="nav.sidebar_toggle"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
        ) : null}

        <Link
          to="/"
          className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ocid="app.logo_link"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground shadow-subtle">
            <Flame className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-lg font-semibold leading-none tracking-tight">
              StudyForge
            </span>
            <span className="hidden text-[11px] uppercase tracking-[0.16em] text-muted-foreground sm:block">
              Forge your mastery
            </span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitcher />

          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 rounded-full"
                  data-ocid="auth.user_menu"
                >
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  <span className="max-w-[9rem] truncate font-mono text-xs">
                    {handle ?? "Signed in"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                  Signed in as
                </DropdownMenuLabel>
                <div className="px-2 pb-2">
                  <p className="break-all font-mono text-xs text-foreground">
                    {account?.email ?? handle}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={signOut}
                  className="gap-2 text-destructive focus:text-destructive"
                  data-ocid="auth.sign_out_button"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              asChild
              type="button"
              size="sm"
              className="gap-2 rounded-full"
              data-ocid="auth.sign_in_button"
            >
              <Link to="/login">
                <LogIn className="h-4 w-4" aria-hidden="true" /> Sign in
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
