import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { createTestUser, deleteTestUsers, serviceClient, type TestUser } from "./helpers";

// AUD10-02: a user with a pending forced password change (PRD US-9, US-11)
// can call no Server Action except changing the password and signing out,
// even calling them directly. The session is the test user's own client and
// the session user is read for real (getSessionUser over that client), so the
// refusal comes from the profile in the database.
const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
// Outside a request there are no cookies to set.
vi.mock("@/lib/sesion/marca-servidor", () => ({ sellarActividad: async () => true, borrarActividad: async () => undefined }));

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
