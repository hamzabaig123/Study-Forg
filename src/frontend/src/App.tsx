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
  useAccountCacheScope();

  return (
    <ThemeProvider>
      <RouterProvider router={router} />
      <SpeedInsights />
      <Toaster position="top-right" richColors closeButton />
    </ThemeProvider>
  );
}
