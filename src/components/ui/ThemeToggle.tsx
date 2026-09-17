"use client";

import { useState } from "react";
import { themeCookieString, type Theme } from "@/lib/theme/theme";
import { Button } from "./Button";

export type ThemeToggleProps = {
  initialTheme: Theme;
  // Label shown while in light mode (switches to dark), and vice versa.
  toDarkLabel: string;
  toLightLabel: string;
  className?: string;
};

export function ThemeToggle({
  initialTheme,
  toDarkLabel,
  toLightLabel,
  className,
}: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.cookie = themeCookieString(next);
    setTheme(next);
  }

  return (
    <Button
      variant="secondary"
      onClick={toggle}
      aria-pressed={theme === "dark"}
      data-testid="theme-toggle"
      className={className}
    >
      {theme === "dark" ? toLightLabel : toDarkLabel}
    </Button>
  );
}
