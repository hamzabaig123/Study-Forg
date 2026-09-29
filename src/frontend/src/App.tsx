import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { MotionProvider } from "@/components/motion/provider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { useAccountCacheScope } from "@/hooks/useAccountCacheScope";
import { router } from "@/router";
import { RouterProvider } from "@tanstack/react-router";
// The `/react` entry, not `/next`: this is a Vite app, and the Next build of the
// same package imports `next/navigation` for its route signal, which resolves to
// nothing here.
import { Analytics } from "@vercel/analytics/react";
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
        {/* `mode` is named rather than left on the package's `auto`, which reads
            `process.env.NODE_ENV` — a Node global a Vite browser bundle has no
            reason to define, so it falls back to "production" and every `pnpm
            dev` and every seeded E2E run would land in the analytics dashboard
            as real traffic. `PROD` is the one flag that means "this came out of
            `vite build`". */}
        <Analytics mode={import.meta.env.PROD ? "production" : "development"} />
        <SpeedInsights />
        <Toaster position="top-right" richColors closeButton />
      </MotionProvider>
    </ThemeProvider>
  );
}
