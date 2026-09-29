import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./session";

// The central action guard: no session, an inactive account, a pending
// forced password change and a wrong role are refused; the exemptions are
// explicit.

const state = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./session", () => ({ getSessionUser: async () => state.user }));

const { autorizarAccion, sesionParaCerrar, sessionWithRole, usuarioActivo } = await import("./require-role");

function user(over: Partial<SessionUser> = {}, cuenta: Partial<NonNullable<SessionUser["cuenta"]>> = {}): SessionUser {
  return { id: "u1", email: "a@mitsm.test", role: "admin", cuenta: { estadoCuenta: "activa", debeCambiarPassword: false, ...cuenta }, ...over };
}

beforeEach(() => {
  state.user = null;
});

describe("autorizarAccion", () => {
  it("lets an active user through, with the role when asked", async () => {
    state.user = user();
    await expect(autorizarAccion()).resolves.toMatchObject({ ok: true });
    await expect(autorizarAccion({ rol: "admin" })).resolves.toMatchObject({ ok: true });
    await expect(autorizarAccion({ rol: "empleado" })).resolves.toEqual({ ok: false, motivo: "rol" });
  });

  it("refuses no session, an unreadable account and an inactive one", async () => {
    await expect(autorizarAccion()).resolves.toEqual({ ok: false, motivo: "sin-sesion" });
    state.user = user({ cuenta: null });
    await expect(autorizarAccion()).resolves.toEqual({ ok: false, motivo: "sin-sesion" });
    state.user = user({}, { estadoCuenta: "inactiva" });
    await expect(autorizarAccion({ permitirCambioPendiente: true })).resolves.toEqual({ ok: false, motivo: "inactiva" });
  });

  it("refuses a pending forced password change, unless explicitly allowed", async () => {
    state.user = user({}, { debeCambiarPassword: true });
    await expect(autorizarAccion()).resolves.toEqual({ ok: false, motivo: "cambio-pendiente" });
    await expect(autorizarAccion({ rol: "admin" })).resolves.toEqual({ ok: false, motivo: "cambio-pendiente" });
    await expect(autorizarAccion({ permitirCambioPendiente: true })).resolves.toMatchObject({ ok: true });
    await expect(sessionWithRole("admin")).resolves.toBeNull();
    await expect(usuarioActivo()).resolves.toBeNull();
  });

  it("sessionWithRole and usuarioActivo return the user or null", async () => {
    state.user = user({ role: "empleado" });
    await expect(usuarioActivo()).resolves.toEqual(state.user);
    await expect(sessionWithRole("empleado")).resolves.toEqual(state.user);
    await expect(sessionWithRole("admin")).resolves.toBeNull();
  });

  it("sesionParaCerrar never refuses (sign-out paths only)", async () => {
    state.user = user({}, { debeCambiarPassword: true, estadoCuenta: "inactiva" });
    await expect(sesionParaCerrar()).resolves.toEqual(state.user);
    state.user = null;
    await expect(sesionParaCerrar()).resolves.toBeNull();
  });
});
