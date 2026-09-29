import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { getServerEnv } from "@/lib/env";
import { claveMarca, firmarMarca, MARCA_COOKIE, sesionIdDeToken } from "@/lib/sesion/marca";
import { updateSession } from "@/lib/supabase/middleware";
import type { Database } from "@/lib/supabase/database.types";
import { createTestUser, deleteTestUsers, serviceClient, TEST_PASSWORD, type TestUser } from "./helpers";

// AUD10-02: a user with a pending forced password change (PRD US-9, US-11)
// can call no Server Action except changing the password and signing out,
// even calling them directly. The session is the test user's own client and
// the session user is read for real (getSessionUser over that client), so the
// refusal comes from the profile in the database.
const session = vi.hoisted(() => ({ client: null as unknown, sellar: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
// Outside a request there are no cookies to set.
vi.mock("@/lib/sesion/marca-servidor", () => ({
  sellarActividad: async (sesionId: string) => {
    session.sellar.push(sesionId);
    return true;
  },
  borrarActividad: async () => undefined,
}));

const miLegajo = await import("@/app/(app)/mi-legajo/actions");
const legajos = await import("@/app/(app)/legajos/actions");
const aprobaciones = await import("@/app/(app)/aprobaciones/actions");
const auth = await import("@/lib/auth/actions");

const noAutorizado = { ok: false, error: copy.cuentas.errors.noAutorizado };
const NUEVA = "NuevaClaveF110-segura";

const GRUPO_B = {
  calle_altura: "Calle 1",
  piso_depto: "",
  localidad: "Localidad",
  partido: "Tigre",
  partido_otro: null,
  telefono_celular: "11 4444-5555",
  email_personal: "prueba@example.test",
};
const LABORALES = {
  numero_legajo: `CF-${Date.now()}`,
  area: "Operaciones",
  puesto: "Chofer",
  fecha_ingreso: "2020-03-01",
  estado_laboral: "activo",
  sede: "San Martín",
  modalidad: "Presencial",
  convenio: "Camioneros",
  bruto_mensual: 1000,
};
const SUBIDA = { tipo: "dni_frente", fileName: "dni.pdf", mimeType: "application/pdf", sizeBytes: 100 };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("forced password change blocks every action but the change and sign-out", () => {
  const service = serviceClient();
  let empleado: TestUser;
  let admin: TestUser;
  let objetivo: TestUser;

  async function solicitudesDe(id: string) {
    const { count } = await service
      .from("solicitudes_cambio")
      .select("id, legajos!inner(profile_id)", { count: "exact", head: true })
      .eq("legajos.profile_id", id);
    return count ?? 0;
  }
  const areaDe = async (id: string) => (await service.from("legajos").select("area").eq("profile_id", id).single()).data?.area;

  beforeAll(async () => {
    empleado = await createTestUser(service, "forzado-empleado");
    admin = await createTestUser(service, "forzado-admin", "admin");
    objetivo = await createTestUser(service, "forzado-objetivo");
    const { error } = await service.from("profiles").update({ debe_cambiar_password: true }).in("id", [empleado.id, admin.id]);
    expect(error).toBeNull();
  });

  afterAll(async () => {
    session.client = null;
    await deleteTestUsers(service, [empleado.id, objetivo.id, admin.id]);
  });

  it("refuses the Empleado's actions, with no data change", async () => {
    session.client = empleado.client;
    expect(await miLegajo.enviarSolicitud({ grupo: "B", valores: GRUPO_B })).toEqual(noAutorizado);
    expect(await miLegajo.prepararSubidaDocumento(SUBIDA)).toEqual(noAutorizado);
    expect(await miLegajo.cancelarSolicitud({ solicitudId: "00000000-0000-4000-8000-000000000000" })).toEqual(noAutorizado);
    expect(await auth.mantenerSesion()).toMatchObject({ ok: false, sesionTerminada: false });
    expect(await solicitudesDe(empleado.id)).toBe(0);
  });

  it("refuses the forced-change Admin's actions, with no data change", async () => {
    session.client = admin.client;
    const antes = await areaDe(objetivo.id);
    expect(await legajos.actualizarDatosLaborales({ profileId: objetivo.id, valores: LABORALES })).toEqual(noAutorizado);
    expect(await legajos.prepararSubidaAdmin({ profileId: objetivo.id, ...SUBIDA })).toEqual(noAutorizado);
    expect(await aprobaciones.contarPendientesCampana()).toEqual(noAutorizado);
    expect(await areaDe(objetivo.id)).toBe(antes);
  });

  it("still lets them change the password; afterwards the same actions work", async () => {
    session.client = empleado.client;
    await expect(auth.cambiarPassword(null, form({ password: NUEVA, confirmacion: NUEVA }))).rejects.toThrow("NEXT_REDIRECT:/mi-legajo");
    const { data: perfil } = await service.from("profiles").select("debe_cambiar_password").eq("id", empleado.id).single();
    expect(perfil?.debe_cambiar_password).toBe(false);
    expect(await miLegajo.enviarSolicitud({ grupo: "B", valores: GRUPO_B })).toEqual({ ok: true });
    expect(await solicitudesDe(empleado.id)).toBe(1);
    expect((await miLegajo.prepararSubidaDocumento(SUBIDA)).ok).toBe(true);

    session.client = admin.client;
    await expect(auth.cambiarPassword(null, form({ password: NUEVA, confirmacion: NUEVA }))).rejects.toThrow("NEXT_REDIRECT:/mi-legajo");
    expect(await legajos.actualizarDatosLaborales({ profileId: objetivo.id, valores: LABORALES })).toEqual({ ok: true });
    expect(await areaDe(objetivo.id)).toBe("Operaciones");
    expect((await aprobaciones.contarPendientesCampana()).ok).toBe(true);
  });
});

// FIX-03: while the change is pending, a refused request must not keep the
// session alive. The real proxy runs over a real session (its cookies), with
// the CI SESSION_SECRET.
describe("forced password change: refused requests do not renew the activity marker", () => {
  const service = serviceClient();
  let user: TestUser;

  async function sesionReal(password: string) {
    const { supabaseUrl, supabaseAnonKey } = getServerEnv();
    const jar = new Map<string, string>();
    const client = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
      },
    });
    const { data, error } = await client.auth.signInWithPassword({ email: user.email, password });
    if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
    return { jar, sesionId: sesionIdDeToken(data.session.access_token)! };
  }

  function request(path: string, jar: Map<string, string>, marca: string, method = "GET") {
    const cookies = [...jar].map(([name, value]) => `${name}=${value}`);
    cookies.push(`${MARCA_COOKIE}=${marca}`);
    return new NextRequest(new URL(path, "http://localhost:3000"), { method, headers: { cookie: cookies.join("; ") } });
  }
  const reestampa = (response: Response) =>
    response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${MARCA_COOKIE}=v1.`));

  beforeAll(async () => {
    user = await createTestUser(service, "forzado-marca");
    const { error } = await service.from("profiles").update({ debe_cambiar_password: true }).eq("id", user.id);
    expect(error).toBeNull();
  });

  afterAll(async () => {
    session.client = null;
    await deleteTestUsers(service, [user.id]);
  });

  it("does not re-stamp for refused actions, re-stamps after the change, then renews normally", async () => {
    const secreto = process.env.SESSION_SECRET;
    if (!secreto) throw new Error("SESSION_SECRET is required for this test");
    const clave = await claveMarca(secreto);

    const s = await sesionReal(TEST_PASSWORD);
    // Old enough to be renewed under the normal rule.
    const marca = await firmarMarca(clave, s.sesionId, Date.now() - 60_000);
    for (const path of ["/cambiar-password", "/mi-legajo"]) {
      const response = await updateSession(request(path, s.jar, marca, "POST"));
      expect(response.headers.get("location"), path).toBeNull();
      expect(reestampa(response), path).toBe(false);
    }
    // The page itself is the one allowed renewal.
    expect(reestampa(await updateSession(request("/cambiar-password", s.jar, marca)))).toBe(true);

    // The actions behind those requests are refused.
    session.client = user.client;
    expect(await auth.mantenerSesion()).toMatchObject({ ok: false, sesionTerminada: false });
    expect(await miLegajo.enviarSolicitud({ grupo: "B", valores: GRUPO_B })).toEqual(noAutorizado);

    // The change succeeds and re-stamps the marker.
    session.sellar = [];
    await expect(auth.cambiarPassword(null, form({ password: NUEVA, confirmacion: NUEVA }))).rejects.toThrow("NEXT_REDIRECT:/mi-legajo");
    expect(session.sellar).toHaveLength(1);

    // Afterwards (a new session with the new password), normal renewal.
    const despues = await sesionReal(NUEVA);
    const vieja = await firmarMarca(clave, despues.sesionId, Date.now() - 60_000);
    expect(reestampa(await updateSession(request("/mi-legajo", despues.jar, vieja, "POST")))).toBe(true);
    expect(reestampa(await updateSession(request("/mi-legajo", despues.jar, vieja)))).toBe(true);
  });
});
