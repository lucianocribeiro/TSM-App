import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The proxy (route guard + session refresh), with the Supabase client
// replaced so the claims and the own-profile read can be set per test. The
// activity marker is real: signed with the same key derivation as in
// production, from a test secret.

const SESION = "11111111-2222-4333-8444-555555555555";

const state = vi.hoisted(() => ({
  claims: { sub: "user-1", session_id: "11111111-2222-4333-8444-555555555555" } as Record<string, unknown> | null,
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
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const { updateSession } = await import("./middleware");
const { claveMarca, firmarMarca, MARCA_COOKIE } = await import("@/lib/sesion/marca");

const SESSION_COOKIE = "sb-127-auth-token";
const clave = await claveMarca("test-service-role-key");

async function marca(haceMs = 0, sesion = SESION) {
  return firmarMarca(clave, sesion, Date.now() - haceMs);
}

async function request(
  path: string,
  { method = "GET", marcaValor, headers = {} }: { method?: string; marcaValor?: string | null; headers?: Record<string, string> } = {},
) {
  const valor = marcaValor === undefined ? await marca() : marcaValor;
  const cookies = [`${SESSION_COOKIE}=token`, "tsm-theme=dark", ...(valor ? [`${MARCA_COOKIE}=${valor}`] : [])];
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method,
    headers: { cookie: cookies.join("; "), ...headers },
  });
}

// Path and query of the redirect, or null when the request continues.
function locationOf(response: Response): string | null {
  const location = response.headers.get("location");
  if (!location) return null;
  const url = new URL(location);
  return url.pathname + url.search;
}

function clears(response: Response, name: string): boolean {
  return response.headers
    .getSetCookie()
    .some((cookie) => cookie.startsWith(`${name}=;`) && /expires=Thu, 01 Jan 1970/i.test(cookie));
}
const clearsSession = (response: Response) => clears(response, SESSION_COOKIE) && clears(response, MARCA_COOKIE);

function setsMarker(response: Response): string | null {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${MARCA_COOKIE}=`) && !value.startsWith(`${MARCA_COOKIE}=;`));
  return cookie ?? null;
}

function perfil(over: Record<string, unknown> = {}) {
  return { data: { role: "empleado", estado_cuenta: "activa", debe_cambiar_password: false, ...over }, error: null };
}

beforeEach(() => {
  state.claims = { sub: "user-1", session_id: SESION };
  state.profile = perfil();
  state.signOut.mockReset().mockResolvedValue({ error: null });
});

describe("proxy route guard", () => {
  it("lets an active account through and forwards the pathname", async () => {
    const response = await updateSession(await request("/mi-legajo"));
    expect(locationOf(response)).toBeNull();
    expect(response.headers.get("x-middleware-request-x-tsm-pathname")).toBe("/mi-legajo");
    expect(state.signOut).not.toHaveBeenCalled();
    // A fresh marker is not re-signed on every request.
    expect(setsMarker(response)).toBeNull();
  });

  it("re-stamps an older marker on a user request, not on a prefetch", async () => {
    const vieja = await marca(60_000);
    const response = await updateSession(await request("/mi-legajo", { marcaValor: vieja }));
    const cookie = setsMarker(response);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).not.toContain(vieja);

    const prefetch = await updateSession(await request("/mi-legajo", { marcaValor: vieja, headers: { "next-router-prefetch": "1" } }));
    expect(locationOf(prefetch)).toBeNull();
    expect(setsMarker(prefetch)).toBeNull();
  });

  describe("1. no session", () => {
    beforeEach(() => {
      state.claims = null;
    });

    it("sends protected pages to /login with the path to return to", async () => {
      expect(locationOf(await updateSession(await request("/legajos/abc?x=1")))).toBe("/login?volver=%2Flegajos%2Fabc%3Fx%3D1");
      expect(locationOf(await updateSession(await request("/mi-legajo")))).toBe("/login?volver=%2Fmi-legajo");
      expect(locationOf(await updateSession(await request("/")))).toBe("/login");
      // Unmapped: denied, with nothing to return to.
      expect(locationOf(await updateSession(await request("/no-existe")))).toBe("/login");
      expect(state.signOut).not.toHaveBeenCalled();
    });

    it("lets public routes and non-navigation requests through", async () => {
      expect(locationOf(await updateSession(await request("/login")))).toBeNull();
      expect(locationOf(await updateSession(await request("/auth/salir")))).toBeNull();
      expect(locationOf(await updateSession(await request("/mi-legajo", { method: "POST" })))).toBeNull();
    });
  });

  describe("2. account inactive or not verifiable", () => {
    it.each([
      ["the profile read fails", { data: null, error: { code: "500", message: "db down" } }],
      ["the profile has no row", { data: null, error: null }],
    ])("fails closed when %s: signs out and sends to /login with the reason", async (_label, profile) => {
      state.profile = profile;
      for (const path of ["/mi-legajo", "/legajos", "/cambiar-password", "/"]) {
        const response = await updateSession(await request(path));
        expect(response.status, path).toBe(307);
        expect(locationOf(response), path).toBe("/login?cuenta=no-verificada");
        expect(clearsSession(response), path).toBe(true);
        // The theme cookie is not a session cookie and stays.
        expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith("tsm-theme=")), path).toBe(false);
      }
      expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
    });

    it("signs out an inactive account, before any other check", async () => {
      state.profile = perfil({ estado_cuenta: "inactiva", debe_cambiar_password: true });
      const response = await updateSession(await request("/legajos", { marcaValor: null }));
      expect(locationOf(response)).toBe("/login?cuenta=inactiva");
      expect(clears(response, SESSION_COOKIE)).toBe(true);
    });

    it("on a Server Action, clears the session without redirecting: the action answers", async () => {
      state.profile = { data: null, error: { code: "500" } };
      const response = await updateSession(await request("/mi-legajo", { method: "POST" }));
      expect(locationOf(response)).toBeNull();
      expect(clearsSession(response)).toBe(true);
    });

    it("on the login page with that reason, clears the session without redirecting again", async () => {
      state.profile = { data: null, error: null };
      const response = await updateSession(await request("/login?cuenta=no-verificada"));
      expect(locationOf(response)).toBeNull();
      expect(clearsSession(response)).toBe(true);
    });
  });

  describe("3. forced password change", () => {
    it("allows only /cambiar-password (and public routes)", async () => {
      state.profile = perfil({ debe_cambiar_password: true, role: "admin" });
      for (const path of ["/mi-legajo", "/legajos", "/aprobaciones", "/", "/no-existe"]) {
        expect(locationOf(await updateSession(await request(path))), path).toBe("/cambiar-password");
      }
      expect(locationOf(await updateSession(await request("/cambiar-password")))).toBeNull();
      expect(locationOf(await updateSession(await request("/auth/salir")))).toBeNull();
    });
  });

  describe("4. role and default deny", () => {
    it("sends an Empleado away from Admin routes and anyone away from unmapped ones", async () => {
      for (const path of ["/legajos", "/legajos/abc", "/usuarios", "/usuarios/abc", "/aprobaciones", "/aprobaciones/solicitudes/x", "/aprobaciones/cualquiera/x/y"]) {
        expect(locationOf(await updateSession(await request(path))), path).toBe("/mi-legajo");
      }
      state.profile = perfil({ role: "admin" });
      for (const path of ["/legajos", "/usuarios/abc", "/aprobaciones/documentos/x", "/mi-legajo"]) {
        expect(locationOf(await updateSession(await request(path))), path).toBeNull();
      }
      expect(locationOf(await updateSession(await request("/no-existe")))).toBe("/mi-legajo");
    });
  });

  describe("5. inactivity", () => {
    const LOGIN_INACTIVIDAD = "/login?sesion=inactividad";

    it("ends a session whose marker is expired, missing, forged, altered or from another session", async () => {
      const valida = await marca(60_000);
      const [version, sesion, , firma] = valida.split(".");
      const casos: [string, string | null][] = [
        ["expired", await marca(15 * 60 * 1000 + 1000)],
        ["missing", null],
        ["forged", `v1.${SESION}.${Date.now()}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`],
        ["extended by the client", `${version}.${sesion}.${Date.now()}.${firma}`],
        ["from another session", await marca(0, "99999999-2222-4333-8444-555555555555")],
        ["stamped in the future", await marca(-10 * 60 * 1000)],
        ["signed with another key", await firmarMarca(await claveMarca("otra-clave"), SESION, Date.now())],
      ];
      for (const [label, valor] of casos) {
        state.signOut.mockClear();
        const response = await updateSession(await request("/mi-legajo", { marcaValor: valor }));
        expect(locationOf(response), label).toBe(LOGIN_INACTIVIDAD);
        expect(clears(response, SESSION_COOKIE), label).toBe(true);
        expect(state.signOut, label).toHaveBeenCalled();
      }
    });

    it("clears an expired session on a Server Action without redirecting", async () => {
      const response = await updateSession(await request("/mi-legajo", { method: "POST", marcaValor: await marca(16 * 60 * 1000) }));
      expect(locationOf(response)).toBeNull();
      expect(clearsSession(response)).toBe(true);
    });

    it("a token without a session id cannot carry a marker", async () => {
      state.claims = { sub: "user-1" };
      expect(locationOf(await updateSession(await request("/mi-legajo")))).toBe(LOGIN_INACTIVIDAD);
    });

    it("does not redirect the login page to itself", async () => {
      const response = await updateSession(await request("/login?sesion=inactividad", { marcaValor: null }));
      expect(locationOf(response)).toBeNull();
      expect(clears(response, SESSION_COOKIE)).toBe(true);
    });
  });
});
