import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getServerEnv } from "@/lib/env";
import { claveMarca, firmarMarca, MARCA_COOKIE, sesionIdDeToken } from "@/lib/sesion/marca";
import { updateSession } from "@/lib/supabase/middleware";
import type { Database } from "@/lib/supabase/database.types";
import { createTestUser, deleteTestUsers, serviceClient, TEST_PASSWORD, type TestUser } from "./helpers";

// The route guard (the proxy) against the local stack, with real Supabase
// session cookies: a deactivated user with a live session, a forced password
// change, roles, and the server-side inactivity marker (stale, forged,
// extended, or from another session).

type Jar = Map<string, string>;

// Signs in the way the browser does (@supabase/ssr), keeping the cookies.
async function sesionReal(email: string): Promise<{ jar: Jar; sesionId: string }> {
  const { supabaseUrl, supabaseAnonKey } = getServerEnv();
  const jar: Jar = new Map();
  const client = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
  const sesionId = sesionIdDeToken(data.session.access_token);
  if (!sesionId) throw new Error("no session id");
  return { jar, sesionId };
}

function request(path: string, jar: Jar, marca: string | null) {
  const cookies = [...jar].map(([name, value]) => `${name}=${value}`);
  if (marca) cookies.push(`${MARCA_COOKIE}=${marca}`);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers: { cookie: cookies.join("; ") } });
}

function destino(response: Response): string | null {
  const location = response.headers.get("location");
  if (!location) return null;
  const url = new URL(location);
  return url.pathname + url.search;
}

function borraSesion(response: Response): boolean {
  return response.headers.getSetCookie().some((cookie) => cookie.startsWith("sb-") && /expires=Thu, 01 Jan 1970/i.test(cookie));
}

describe("route guard against the local stack", () => {
  const service = serviceClient();
  let clave: CryptoKey;
  let empleado: TestUser;
  let admin: TestUser;
  const ids: string[] = [];

  const marca = (sesionId: string, haceMs = 0) => firmarMarca(clave, sesionId, Date.now() - haceMs);

  beforeAll(async () => {
    clave = await claveMarca(getServerEnv().supabaseServiceRoleKey);
    empleado = await createTestUser(service, "guardia-empleado");
    admin = await createTestUser(service, "guardia-admin", "admin");
    ids.push(empleado.id, admin.id);
  });

  afterAll(async () => {
    await deleteTestUsers(service, ids);
  });

  it("lets an active session with a fresh marker through, and applies roles", async () => {
    const e = await sesionReal(empleado.email);
    expect(destino(await updateSession(request("/mi-legajo", e.jar, await marca(e.sesionId))))).toBeNull();
    expect(destino(await updateSession(request("/legajos", e.jar, await marca(e.sesionId))))).toBe("/mi-legajo");
    expect(destino(await updateSession(request("/aprobaciones", e.jar, await marca(e.sesionId))))).toBe("/mi-legajo");

    const a = await sesionReal(admin.email);
    for (const path of ["/legajos", "/usuarios", "/aprobaciones", "/mi-legajo"]) {
      expect(destino(await updateSession(request(path, a.jar, await marca(a.sesionId)))), path).toBeNull();
    }
  });

  it("refuses a deactivated user's live session on the next request", async () => {
    const user = await createTestUser(service, "guardia-baja");
    ids.push(user.id);
    const s = await sesionReal(user.email);
    expect(destino(await updateSession(request("/mi-legajo", s.jar, await marca(s.sesionId))))).toBeNull();

    const { error } = await service.from("profiles").update({ estado_cuenta: "inactiva" }).eq("id", user.id);
    expect(error).toBeNull();
    const response = await updateSession(request("/mi-legajo", s.jar, await marca(s.sesionId)));
    expect(destino(response)).toBe("/login?cuenta=inactiva");
    expect(borraSesion(response)).toBe(true);
  });

  it("confines a user with a pending password change to /cambiar-password", async () => {
    const user = await createTestUser(service, "guardia-forzado", "admin");
    ids.push(user.id);
    const { error } = await service.from("profiles").update({ debe_cambiar_password: true }).eq("id", user.id);
    expect(error).toBeNull();
    const s = await sesionReal(user.email);
    for (const path of ["/mi-legajo", "/legajos", "/aprobaciones", "/"]) {
      expect(destino(await updateSession(request(path, s.jar, await marca(s.sesionId)))), path).toBe("/cambiar-password");
    }
    expect(destino(await updateSession(request("/cambiar-password", s.jar, await marca(s.sesionId))))).toBeNull();
  });

  it("refuses a stale, forged, extended, missing or foreign activity marker", async () => {
    const otra = await sesionReal(admin.email);
    // Each case gets its own session: refusing one signs it out.
    const casos: [string, (sesionId: string) => Promise<string | null>][] = [
      ["stale (16 minutes)", (id) => marca(id, 16 * 60 * 1000)],
      ["forged", async (id) => `v1.${id}.${Date.now()}.${"A".repeat(43)}`],
      [
        "extended by the client",
        async (id) => {
          const [version, sesion, , firma] = (await marca(id, 10 * 60 * 1000)).split(".");
          return `${version}.${sesion}.${Date.now()}.${firma}`;
        },
      ],
      ["missing", async () => null],
      ["from another session", async () => marca(otra.sesionId)],
    ];
    for (const [label, construir] of casos) {
      const s = await sesionReal(empleado.email);
      const response = await updateSession(request("/mi-legajo", s.jar, await construir(s.sesionId)));
      expect(destino(response), label).toBe("/login?sesion=inactividad");
      expect(borraSesion(response), label).toBe(true);
    }

    // A genuine, recent marker of the same session is accepted and re-stamped.
    const s = await sesionReal(empleado.email);
    const response = await updateSession(request("/mi-legajo", s.jar, await marca(s.sesionId, 60_000)));
    expect(destino(response)).toBeNull();
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${MARCA_COOKIE}=v1.`))).toBe(true);
  });
});
