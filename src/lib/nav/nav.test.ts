import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { getNavItems, isActivePath } from "./nav";

describe("getNavItems", () => {
  it("shows only Mi Legajo to an empleado", () => {
    expect(getNavItems("empleado")).toEqual([
      { href: "/mi-legajo", label: copy.nav.miLegajo, number: "01" },
    ]);
  });

  it("shows Mi Legajo, Legajos and Usuarios to an admin, numbered in order", () => {
    expect(getNavItems("admin")).toEqual([
      { href: "/mi-legajo", label: copy.nav.miLegajo, number: "01" },
      { href: "/legajos", label: copy.nav.legajos, number: "02" },
      { href: "/usuarios", label: copy.nav.usuarios, number: "03" },
    ]);
  });
});

describe("isActivePath", () => {
  it("matches the route and its children only", () => {
    expect(isActivePath("/legajos", "/legajos")).toBe(true);
    expect(isActivePath("/legajos/123", "/legajos")).toBe(true);
    expect(isActivePath("/legajos-x", "/legajos")).toBe(false);
    expect(isActivePath("/mi-legajo", "/legajos")).toBe(false);
  });
});
