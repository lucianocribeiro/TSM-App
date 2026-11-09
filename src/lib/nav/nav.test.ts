import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { getNavItems, isActivePath } from "./nav";

describe("getNavItems", () => {
  it("shows Mi Legajo and Mis Recibos to an empleado", () => {
    expect(getNavItems("empleado")).toEqual([
      { href: "/mi-legajo", label: copy.nav.miLegajo, number: "01" },
      { href: "/mis-recibos", label: copy.nav.misRecibos, number: "02" },
    ]);
  });

  it("adds the pending receipts count to Mis Recibos only, with its accessible name (F2-05)", () => {
    const [miLegajo, misRecibos] = getNavItems("empleado", { misRecibosPendientes: 3 });
    expect(miLegajo.badge).toBeUndefined();
    expect(misRecibos).toMatchObject({ badge: "3", ariaLabel: "Mis Recibos, 3 pendientes de firma" });
    expect(getNavItems("empleado", { misRecibosPendientes: 1 })[1].ariaLabel).toBe("Mis Recibos, 1 pendiente de firma");
    expect(getNavItems("empleado", { misRecibosPendientes: 0 })[1].badge).toBeUndefined();
    expect(getNavItems("admin", { misRecibosPendientes: 3 }).some((item) => item.badge)).toBe(false);
  });

  it("shows Mi Legajo, Legajos, Aprobaciones, Recibos, Usuarios and Configuración to an admin, numbered in order", () => {
    expect(getNavItems("admin")).toEqual([
      { href: "/mi-legajo", label: copy.nav.miLegajo, number: "01" },
      { href: "/legajos", label: copy.nav.legajos, number: "02" },
      { href: "/aprobaciones", label: copy.nav.aprobaciones, number: "03" },
      { href: "/recibos", label: copy.nav.recibos, number: "04" },
      { href: "/usuarios", label: copy.nav.usuarios, number: "05" },
      { href: "/configuracion", label: copy.nav.configuracion, number: "06" },
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
