export const THEME_COOKIE = "tsm-theme";

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "light";

// One year, in seconds.
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseTheme(value: string | undefined | null): Theme {
  return value === "light" || value === "dark" ? value : DEFAULT_THEME;
}

export function themeCookieString(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}
