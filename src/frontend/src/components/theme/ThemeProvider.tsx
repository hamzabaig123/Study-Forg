import { safeGetItem, safeSetItem } from "@/lib/localStore";
import type { ThemeName } from "@/types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PropsWithChildren } from "react";

const STORAGE_KEY = "studyforge-theme";
const THEMES: ThemeName[] = ["light", "dark", "frosted"];

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  cycleTheme: () => void;
  themes: ThemeName[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEMES as string[]).includes(value);
}

function readStoredTheme(): ThemeName {
  if (typeof window === "undefined") return "light";
  const stored = safeGetItem(STORAGE_KEY);
  return isThemeName(stored) ? stored : "light";
}

/**
 * Applies exactly one of `light`, `dark`, or `frosted` to the document root.
 *
 * `light` is the absence of both classes; `dark` and `frosted` are the class
 * hooks the design system in index.css keys off. The choice persists to
 * localStorage and is restored before first paint via the inline script in
 * index.html.
 */
export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setThemeState] = useState<ThemeName>(readStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("frosted", theme === "frosted");
    root.style.colorScheme = theme === "dark" ? "dark" : "light";
    safeSetItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeName) => {
    // Crossfade the swap: for one beat every surface eases its background,
    // border, and text colour to the new palette instead of snapping. Skipped
    // for reduced-motion users, and re-entrant — flipping themes quickly
    // restarts the window rather than stacking transitions.
    if (
      typeof window !== "undefined" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const root = document.documentElement;
      root.classList.remove("theme-switching");
      // Force a style flush so a rapid second switch restarts the ease.
      void root.offsetWidth;
      root.classList.add("theme-switching");
      window.setTimeout(() => root.classList.remove("theme-switching"), 480);
    }
    setThemeState(next);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const index = THEMES.indexOf(current);
      return THEMES[(index + 1) % THEMES.length];
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, cycleTheme, themes: THEMES }),
    [theme, setTheme, cycleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
