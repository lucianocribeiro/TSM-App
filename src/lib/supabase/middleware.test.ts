import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The proxy path of the account gate, with the Supabase client replaced so
// the profile read can be forced to fail or to find no row.

const state = vi.hoisted(() => ({
  claims: { sub: "user-1" } as { sub: string } | null,
  profile: { data: null as unknown, error: null as unknown },
  signOut: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({ data: state.claims ? { claims: state.claims } : null, error: null }),
      signOut: state.signOut,
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => state.profile }) }),
    }),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

const { updateSession } = await import("./middleware");

const SESSION_COOKIE = "sb-127-auth-token";

function request(path: string, method = "GET") {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method,
    headers: { cookie: `${SESSION_COOKIE}=token; tsm-theme=dark` },
  });
}

// Path and query of the redirect, or null when the request continues.
function locationOf(response: Response): string | null {
  const location = response.headers.get("location");
  if (!location) return null;
  const url = new URL(location);
  return url.pathname + url.search;
}

function clearsSession(response: Response): boolean {
  return response.headers
    .getSetCookie()
    .some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=;`) && /expires=Thu, 01 Jan 1970/i.test(cookie));
}

beforeEach(() => {
  state.claims = { sub: "user-1" };
  state.profile = { data: { estado_cuenta: "activa", debe_cambiar_password: false }, error: null };
  state.signOut.mockReset().mockResolvedValue({ error: null });
});

describe("proxy account gate", () => {
  it("lets an active account through and forwards the pathname", async () => {
    const response = await updateSession(request("/mi-legajo"));
    expect(locationOf(response)).toBeNull();
    expect(response.headers.get("x-middleware-request-x-tsm-pathname")).toBe("/mi-legajo");
    expect(state.signOut).not.toHaveBeenCalled();
  });

  it.each([
    ["the profile read fails", { data: null, error: { code: "500", message: "db down" } }],
    ["the profile has no row", { data: null, error: null }],
  ])("fails closed when %s: signs out and sends to /login with the reason", async (_label, profile) => {
    state.profile = profile;
    for (const path of ["/mi-legajo", "/legajos", "/cambiar-password", "/"]) {
      const response = await updateSession(request(path));
      expect(response.status, path).toBe(307);
      expect(locationOf(response), path).toBe("/login?cuenta=no-verificada");
      expect(clearsSession(response), path).toBe(true);
      // The theme cookie is not a session cookie and stays.
      expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith("tsm-theme=")), path).toBe(false);
    }
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("fails closed for form posts too", async () => {
    state.profile = { data: null, error: { code: "500" } };
    const response = await updateSession(request("/mi-legajo", "POST"));
    expect(response.status).toBe(307);
    expect(clearsSession(response)).toBe(true);
  });

  it("on the no-verificada login page, clears the session without redirecting again", async () => {
    state.profile = { data: null, error: null };
    const response = await updateSession(request("/login?cuenta=no-verificada"));
    expect(locationOf(response)).toBeNull();
    expect(clearsSession(response)).toBe(true);
  });

  it("does not let a pending password change be bypassed", async () => {
    state.profile = { data: { estado_cuenta: "activa", debe_cambiar_password: true }, error: null };
    const response = await updateSession(request("/mi-legajo"));
    expect(locationOf(response)).toBe("/cambiar-password");
  });

  it("signs out an inactive account", async () => {
    state.profile = { data: { estado_cuenta: "inactiva", debe_cambiar_password: false }, error: null };
    const response = await updateSession(request("/mi-legajo"));
    expect(locationOf(response)).toBe("/login?cuenta=inactiva");
    expect(clearsSession(response)).toBe(true);
  });

  it("does nothing without a session", async () => {
    state.claims = null;
    state.profile = { data: null, error: { code: "500" } };
    const response = await updateSession(request("/mi-legajo"));
    expect(locationOf(response)).toBeNull();
    expect(state.signOut).not.toHaveBeenCalled();
  });
});
