import { describe, expect, it } from "vitest";
import { decideAccountGate, type GateInput } from "./gate";

function input(overrides: Partial<GateInput>): GateInput {
  return {
    pathname: "/mi-legajo",
    searchParams: new URLSearchParams(),
    method: "GET",
    estadoCuenta: "activa",
    debeCambiarPassword: false,
    ...overrides,
  };
}

describe("decideAccountGate", () => {
  it("lets an active user without a pending change through", () => {
    for (const pathname of ["/", "/mi-legajo", "/legajos", "/usuarios", "/login"]) {
      expect(decideAccountGate(input({ pathname })), pathname).toEqual({ action: "continue" });
    }
  });

  it("signs an inactive user out and sends them to the inactive-account login, for any request", () => {
    for (const method of ["GET", "POST"]) {
      for (const pathname of ["/mi-legajo", "/cambiar-password", "/", "/login"]) {
        expect(
          decideAccountGate(input({ pathname, method, estadoCuenta: "inactiva", debeCambiarPassword: true })),
          `${method} ${pathname}`,
        ).toEqual({ action: "signOut", to: "/login?cuenta=inactiva" });
      }
    }
  });

  it("signs an inactive user out without redirecting when already on the inactive-account login", () => {
    expect(
      decideAccountGate(
        input({ pathname: "/login", searchParams: new URLSearchParams("cuenta=inactiva"), estadoCuenta: "inactiva" }),
      ),
    ).toEqual({ action: "signOut", to: null });
  });

  it("sends a user who must change their password to /cambiar-password from any other page", () => {
    for (const pathname of ["/", "/mi-legajo", "/legajos", "/usuarios", "/login", "/cualquier-cosa"]) {
      expect(decideAccountGate(input({ pathname, debeCambiarPassword: true })), pathname).toEqual({
        action: "redirect",
        to: "/cambiar-password",
      });
    }
    expect(decideAccountGate(input({ pathname: "/cambiar-password", debeCambiarPassword: true }))).toEqual({
      action: "continue",
    });
  });

  it("keeps /cambiar-password out of reach when no change is pending", () => {
    expect(decideAccountGate(input({ pathname: "/cambiar-password" }))).toEqual({
      action: "redirect",
      to: "/mi-legajo",
    });
  });

  it("does not redirect form posts; the Server Action answers them", () => {
    expect(decideAccountGate(input({ method: "POST", pathname: "/mi-legajo", debeCambiarPassword: true }))).toEqual({
      action: "continue",
    });
    expect(decideAccountGate(input({ method: "HEAD", pathname: "/mi-legajo", debeCambiarPassword: true }))).toEqual({
      action: "redirect",
      to: "/cambiar-password",
    });
  });
});
