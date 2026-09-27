import { describe, expect, it } from "vitest";
import { decideAccountGate, motivoSalida, type CuentaActual, type GateInput } from "./gate";

const ACTIVA: CuentaActual = { estadoCuenta: "activa", debeCambiarPassword: false };
const PENDIENTE: CuentaActual = { estadoCuenta: "activa", debeCambiarPassword: true };
const INACTIVA: CuentaActual = { estadoCuenta: "inactiva", debeCambiarPassword: false };

function input(overrides: Partial<GateInput>): GateInput {
  return {
    pathname: "/mi-legajo",
    searchParams: new URLSearchParams(),
    method: "GET",
    cuenta: ACTIVA,
    ...overrides,
  };
}

const ALL_PATHS = ["/", "/mi-legajo", "/legajos", "/usuarios", "/cambiar-password", "/login", "/auth/salir"];

describe("decideAccountGate", () => {
  it("lets an active user without a pending change through", () => {
    for (const pathname of ["/", "/mi-legajo", "/legajos", "/usuarios", "/login", "/cambiar-password"]) {
      expect(decideAccountGate(input({ pathname })), pathname).toEqual({ action: "continue" });
    }
  });

  it("fails closed: an account that cannot be verified is signed out, for any request", () => {
    for (const method of ["GET", "POST"]) {
      for (const pathname of ALL_PATHS) {
        expect(decideAccountGate(input({ pathname, method, cuenta: null })), `${method} ${pathname}`).toEqual({
          action: "signOut",
          to: "/login?cuenta=no-verificada",
        });
      }
    }
  });

  it("signs an unverifiable account out without redirecting when already on its login page", () => {
    expect(
      decideAccountGate(
        input({ pathname: "/login", searchParams: new URLSearchParams("cuenta=no-verificada"), cuenta: null }),
      ),
    ).toEqual({ action: "signOut", to: null });
    // The other reason's page is not a match.
    expect(
      decideAccountGate(input({ pathname: "/login", searchParams: new URLSearchParams("cuenta=inactiva"), cuenta: null })),
    ).toEqual({ action: "signOut", to: "/login?cuenta=no-verificada" });
  });

  it("signs an inactive user out and sends them to the inactive-account login, for any request", () => {
    for (const method of ["GET", "POST"]) {
      for (const pathname of ALL_PATHS) {
        for (const cuenta of [INACTIVA, { estadoCuenta: "inactiva" as const, debeCambiarPassword: true }]) {
          expect(decideAccountGate(input({ pathname, method, cuenta })), `${method} ${pathname}`).toEqual({
            action: "signOut",
            to: "/login?cuenta=inactiva",
          });
        }
      }
    }
  });

  it("signs an inactive user out without redirecting when already on the inactive-account login", () => {
    expect(
      decideAccountGate(
        input({ pathname: "/login", searchParams: new URLSearchParams("cuenta=inactiva"), cuenta: INACTIVA }),
      ),
    ).toEqual({ action: "signOut", to: null });
  });

  it("sends a user who must change their password to /cambiar-password from any other page", () => {
    for (const pathname of ["/", "/mi-legajo", "/legajos", "/usuarios", "/login", "/cualquier-cosa"]) {
      expect(decideAccountGate(input({ pathname, cuenta: PENDIENTE })), pathname).toEqual({
        action: "redirect",
        to: "/cambiar-password",
      });
    }
    expect(decideAccountGate(input({ pathname: "/cambiar-password", cuenta: PENDIENTE }))).toEqual({
      action: "continue",
    });
  });

  it("keeps /cambiar-password reachable for a voluntary change", () => {
    expect(decideAccountGate(input({ pathname: "/cambiar-password" }))).toEqual({ action: "continue" });
  });

  it("does not redirect form posts; the Server Action answers them", () => {
    expect(decideAccountGate(input({ method: "POST", pathname: "/mi-legajo", cuenta: PENDIENTE }))).toEqual({
      action: "continue",
    });
    expect(decideAccountGate(input({ method: "HEAD", pathname: "/mi-legajo", cuenta: PENDIENTE }))).toEqual({
      action: "redirect",
      to: "/cambiar-password",
    });
  });
});

describe("motivoSalida", () => {
  it("names why a session must end, or null when it may continue", () => {
    expect(motivoSalida(null)).toBe("no-verificada");
    expect(motivoSalida(INACTIVA)).toBe("inactiva");
    expect(motivoSalida(ACTIVA)).toBeNull();
    expect(motivoSalida(PENDIENTE)).toBeNull();
  });
});
