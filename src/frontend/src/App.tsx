import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { MotionProvider } from "@/components/motion/provider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { useAccountCacheScope } from "@/hooks/useAccountCacheScope";
import { router } from "@/router";
import { RouterProvider } from "@tanstack/react-router";
import { SpeedInsights } from "@vercel/speed-insights/react";

/**
 * App shell: theme provider, router, and the global toast surface.
 * Query and Internet Identity providers live in main.tsx.
 */
export default function App() {
  // The boundary is outside the shell so a hook that throws in the shell is
  // caught by it rather than blanking the page.
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}

function AppShell() {
  useAccountCacheScope();

  return (
    <ThemeProvider>
      <MotionProvider>
        <RouterProvider router={router} />
        <SpeedInsights />
        <Toaster position="top-right" richColors closeButton />
      </MotionProvider>
    </ThemeProvider>
  );
}
