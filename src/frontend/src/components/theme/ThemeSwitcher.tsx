import { useTheme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ThemeName } from "@/types";
import { Check, Flame, Moon, Sun } from "lucide-react";

const THEME_META: Record<
  ThemeName,
  { label: string; hint: string; Icon: typeof Sun }
> = {
  light: { label: "Light", hint: "Warm parchment", Icon: Sun },
  dark: { label: "Dark", hint: "Deep ink", Icon: Moon },
  frosted: { label: "Frosted", hint: "Lit glass", Icon: Flame },
};

export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme, themes } = useTheme();
  const ActiveIcon = THEME_META[theme].Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("gap-2 rounded-full", className)}
          aria-label={`Theme: ${THEME_META[theme].label}. Change theme`}
          data-ocid="theme.toggle"
        >
          <ActiveIcon className="h-4 w-4" aria-hidden="true" />
          <span className="hidden text-xs font-medium uppercase tracking-wider sm:inline">
            {THEME_META[theme].label}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
          Appearance
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {themes.map((name) => {
          const { label, hint, Icon } = THEME_META[name];
          return (
            <DropdownMenuItem
              key={name}
              onSelect={() => setTheme(name)}
              className="gap-3"
              data-ocid={`theme.option.${name}`}
            >
              <Icon
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{label}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {hint}
                </span>
              </span>
              {theme === name ? (
                <Check className="h-4 w-4 text-primary" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
