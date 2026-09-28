import { describe, expect, it } from "vitest";
import { decidirAcceso, type GuardiaInput, type SesionGuardia } from "./guardia";

// The order of the guard's checks (PRD session rules): no session, account
// state, forced password change, role / default deny, inactivity.

const activa = { estadoCuenta: "activa" as const, debeCambiarPassword: false };

function sesion(over: Partial<SesionGuardia> = {}): SesionGuardia {
  return { cuenta: activa, rol: "empleado", actividadVigente: true, ...over };
}

function input(pathname: string, s: SesionGuardia | null, method = "GET"): GuardiaInput {
  const url = new URL(pathname, "http://x");
  return { pathname: url.pathname, search: url.search, searchParams: url.searchParams, method, sesion: s };
}

describe("decidirAcceso: order of checks", () => {
  it("1. no session comes first", () => {
    expect(decidirAcceso(input("/legajos", null))).toEqual({ accion: "redirigir", a: "/login?volver=%2Flegajos" });
  });

  it("2. an inactive account wins over a forced change, a role mismatch and an expired marker", () => {
    const s = sesion({ cuenta: { estadoCuenta: "inactiva", debeCambiarPassword: true }, actividadVigente: false });
    expect(decidirAcceso(input("/legajos", s))).toEqual({ accion: "cerrar", a: "/login?cuenta=inactiva" });
    expect(decidirAcceso(input("/legajos", sesion({ cuenta: null })))).toEqual({ accion: "cerrar", a: "/login?cuenta=no-verificada" });
  });

  it("3. a forced change wins over the role check and inactivity", () => {
    const s = sesion({ cuenta: { estadoCuenta: "activa", debeCambiarPassword: true }, actividadVigente: false });
    expect(decidirAcceso(input("/legajos", s))).toEqual({ accion: "redirigir", a: "/cambiar-password" });
    // On its own page, inactivity then applies.
    expect(decidirAcceso(input("/cambiar-password", s))).toEqual({ accion: "cerrar", a: "/login?sesion=inactividad" });
  });

  it("4. the role check comes before inactivity; unmapped routes are denied", () => {
    const s = sesion({ actividadVigente: false });
    expect(decidirAcceso(input("/aprobaciones", s))).toEqual({ accion: "redirigir", a: "/mi-legajo" });
    expect(decidirAcceso(input("/no-existe", sesion({ rol: "admin" })))).toEqual({ accion: "redirigir", a: "/mi-legajo" });
  });

  it("5. inactivity last", () => {
    expect(decidirAcceso(input("/mi-legajo", sesion({ actividadVigente: false })))).toEqual({
      accion: "cerrar",
      a: "/login?sesion=inactividad",
    });
    expect(decidirAcceso(input("/legajos", sesion({ rol: "admin" })))).toEqual({ accion: "seguir", contarActividad: true });
  });

  it("never redirects a Server Action: only clears a session that must end", () => {
    expect(decidirAcceso(input("/legajos", null, "POST"))).toEqual({ accion: "seguir", contarActividad: false });
    expect(decidirAcceso(input("/legajos", sesion(), "POST"))).toEqual({ accion: "seguir", contarActividad: true });
    expect(decidirAcceso(input("/legajos", sesion({ actividadVigente: false }), "POST"))).toEqual({ accion: "cerrar", a: null });
    expect(decidirAcceso(input("/mi-legajo", sesion({ cuenta: null }), "POST"))).toEqual({ accion: "cerrar", a: null });
  });

  it("public routes stay reachable with a session; the account and inactivity checks still apply", () => {
    const forzado = sesion({ cuenta: { estadoCuenta: "activa", debeCambiarPassword: true } });
    expect(decidirAcceso(input("/auth/salir", forzado))).toEqual({ accion: "seguir", contarActividad: true });
    expect(decidirAcceso(input("/login", sesion({ actividadVigente: false })))).toEqual({
      accion: "cerrar",
      a: "/login?sesion=inactividad",
    });
    expect(decidirAcceso(input("/login?sesion=inactividad", sesion({ actividadVigente: false })))).toEqual({
      accion: "cerrar",
      a: null,
    });
  });
});
