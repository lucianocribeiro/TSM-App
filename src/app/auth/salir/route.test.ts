import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

// /auth/salir: ends a session the account gate rejects, for the app layout.

const state = vi.hoisted(() => ({
  user: null as SessionUser | null,
  signOut: vi.fn(),
  deleted: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut: state.signOut } }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [{ name: "sb-127-auth-token.0" }, { name: "sb-127-auth-token.1" }, { name: "tsm-theme" }],
    delete: (name: string) => state.deleted.push(name),
  }),
}));

const { GET } = await import("./route");

function user(cuenta: SessionUser["cuenta"]): SessionUser {
  return { id: "user-1", email: "ana@mitsm.test", role: "empleado", cuenta };
}

async function call() {
  const response = await GET(new NextRequest("http://localhost:3000/auth/salir?cuenta=inactiva"));
  const url = new URL(response.headers.get("location") ?? "");
  return url.pathname + url.search;
}

beforeEach(() => {
  state.signOut.mockReset().mockResolvedValue({ error: null });
  state.deleted = [];
});

describe("/auth/salir", () => {
  it("signs out an account that cannot be verified and says so at /login", async () => {
    state.user = user(null);
    expect(await call()).toBe("/login?cuenta=no-verificada");
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(state.deleted).toEqual(["sb-127-auth-token.0", "sb-127-auth-token.1"]);
  });

  it("signs out an inactive account", async () => {
    state.user = user({ estadoCuenta: "inactiva", debeCambiarPassword: false });
    expect(await call()).toBe("/login?cuenta=inactiva");
    expect(state.signOut).toHaveBeenCalled();
  });

  it("leaves a healthy session alone, whatever the link says", async () => {
    state.user = user({ estadoCuenta: "activa", debeCambiarPassword: false });
    expect(await call()).toBe("/mi-legajo");
    expect(state.signOut).not.toHaveBeenCalled();
    expect(state.deleted).toEqual([]);
  });

  it("sends a visitor without a session to /login", async () => {
    state.user = null;
    expect(await call()).toBe("/login");
    expect(state.signOut).not.toHaveBeenCalled();
  });

  it("still clears the cookies when signOut throws", async () => {
    state.user = user(null);
    state.signOut.mockRejectedValue(new Error("network down"));
    expect(await call()).toBe("/login?cuenta=no-verificada");
    expect(state.deleted).toHaveLength(2);
  });
});
