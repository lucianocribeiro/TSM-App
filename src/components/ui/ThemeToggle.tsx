"use client";

import { useState } from "react";
import { themeCookieString, type Theme } from "@/lib/theme/theme";
import { cx } from "./cx";

export type ThemeToggleProps = {
  initialTheme: Theme;
  // Accessible name while in light mode (switches to dark), and vice versa.
  toDarkLabel: string;
  toLightLabel: string;
  className?: string;
};

// Icon-only switch between light and dark: a moon in light mode, a sun in
// dark mode. The label says what pressing it does. Same square, border and
// ink as the bell (BellLink) and the menu button (MenuButton).
export function ThemeToggle({
  initialTheme,
  toDarkLabel,
  toLightLabel,
  className,
}: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const label = theme === "dark" ? toLightLabel : toDarkLabel;

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.cookie = themeCookieString(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className={cx(
        "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line bg-rail text-rail-ink transition-colors hover:border-accent hover:text-accent-deep",
        className,
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
          </>
        ) : (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        )}
      </svg>
    </button>
  );
}
