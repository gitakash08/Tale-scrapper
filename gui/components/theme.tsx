"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export type Theme = "light" | "dark";

/**
 * Reads/writes the theme, kept in sync with the <html data-theme> attribute
 * that the layout's pre-paint script already set. `mounted` guards against a
 * hydration mismatch (server always renders the dark default).
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = (document.documentElement.dataset.theme as Theme) || "dark";
    setThemeState(t);
    setMounted(true);
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("rts-theme", t); } catch { /* private mode */ }
  };

  return { theme, setTheme, mounted };
}

/** Icon button that flips between light and dark. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme, mounted } = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => setTheme(next)}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      className={`tap-press grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground ${className}`}
    >
      {/* Shows the icon for the mode you'd switch TO. Neutral until mounted. */}
      {mounted && theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}
