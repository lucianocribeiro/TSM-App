import { describe, expect, it } from "vitest";
import { menuCookieString, MENU_COOKIE, parseEstadoMenu } from "./menu";

describe("parseEstadoMenu", () => {
  it("reads a hidden menu", () => {
    expect(parseEstadoMenu("oculto")).toBe("oculto");
    expect(parseEstadoMenu("visible")).toBe("visible");
  });

  it("shows the menu for missing or invalid values", () => {
    for (const value of [undefined, null, "", "OCULTO", " oculto", "cerrado"]) {
      expect(parseEstadoMenu(value), String(value)).toBe("visible");
    }
  });
});

describe("menuCookieString", () => {
  it("builds a site-wide persistent cookie", () => {
    const cookie = menuCookieString("oculto");
    expect(cookie.startsWith(`${MENU_COOKIE}=oculto;`)).toBe(true);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=");
    expect(cookie).toContain("SameSite=Lax");
  });
});
