import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

// The layout path of the account gate. The proxy normally acts first; here
// the layout is exercised on its own, with the session read forced.

const state = vi.hoisted(() => ({
  user: null as SessionUser | null,
  pathname: "/mi-legajo" as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => state.user }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.pathname ? { "x-tsm-pathname": state.pathname } : {}),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("./AppShell", () => ({ AppShell: () => null }));

const { default: AppLayout } = await import("./layout");

function user(cuenta: SessionUser["cuenta"]): SessionUser {
  return { id: "user-1", email: "ana@mitsm.test", role: "empleado", cuenta };
}

async function render() {
  return AppLayout({ children: null });
}

beforeEach(() => {
  state.pathname = "/mi-legajo";
});

describe("app layout account gate", () => {
  it("sends a user without a session to /login", async () => {
    state.user = null;
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("fails closed: an account that cannot be verified goes to /auth/salir, on any page", async () => {
    state.user = user(null);
    for (const pathname of ["/mi-legajo", "/cambiar-password", null]) {
      state.pathname = pathname;
      await expect(render(), String(pathname)).rejects.toThrow("NEXT_REDIRECT:/auth/salir");
    }
  });

  it("sends an inactive account to /auth/salir", async () => {
    state.user = user({ estadoCuenta: "inactiva", debeCambiarPassword: false });
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/auth/salir");
  });

  it("does not let a pending password change be bypassed", async () => {
    state.user = user({ estadoCuenta: "activa", debeCambiarPassword: true });
    for (const pathname of ["/mi-legajo", "/legajos", "/usuarios"]) {
      state.pathname = pathname;
      await expect(render(), pathname).rejects.toThrow("NEXT_REDIRECT:/cambiar-password");
    }
    state.pathname = "/cambiar-password";
    await expect(render()).resolves.toBeTruthy();
  });

  it("renders for an active account", async () => {
    state.user = user({ estadoCuenta: "activa", debeCambiarPassword: false });
    await expect(render()).resolves.toBeTruthy();
  });
});
