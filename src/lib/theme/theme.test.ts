import { describe, expect, it } from "vitest";
import { parseTheme, themeCookieString, THEME_COOKIE } from "./theme";

describe("parseTheme", () => {
  it("accepts light and dark", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("falls back to light for missing or invalid values", () => {
    expect(parseTheme(undefined)).toBe("light");
    expect(parseTheme(null)).toBe("light");
    expect(parseTheme("")).toBe("light");
    expect(parseTheme("DARK")).toBe("light");
    expect(parseTheme("system")).toBe("light");
    expect(parseTheme(" dark")).toBe("light");
  });
});

describe("themeCookieString", () => {
  it("builds a site-wide persistent cookie", () => {
    const cookie = themeCookieString("dark");
    expect(cookie.startsWith(`${THEME_COOKIE}=dark;`)).toBe(true);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=");
    expect(cookie).toContain("SameSite=Lax");
  });
});
