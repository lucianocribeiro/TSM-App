import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { barrerHuerfanos } from "@/lib/documentos/limpieza";
import { buildDocumentoPath } from "@/lib/documentos/paths";
import { DOCUMENTOS_BUCKET } from "@/lib/documentos/tipos";
import { createTestUser, deleteTestUsers, serviceClient, type TestUser } from "./helpers";

// The /legajos Server Actions (Admin) against the local stack. As in
// mi-legajo-actions.test.ts, the session-bound server client is the signed-in
// test user's client and the session user is that user, so RLS and the
// storage policies decide as in the app.
const session = vi.hoisted(() => ({
  client: null as unknown,
  user: null as null | { id: string; email: string; role: "empleado" | "admin"; cuenta: unknown },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));

const actions = await import("@/app/(app)/legajos/actions");
const { cargarListadoLegajos } = await import("@/lib/legajo/admin-legajos");

const ACTIVA = { estadoCuenta: "activa", debeCambiarPassword: false };
const noAutorizado = { ok: false, error: copy.cuentas.errors.noAutorizado };

const GRUPO_A = {
  nombres: "Prueba",
  apellido: "Legajos",
  dni: "94100001",
  nacionalidad: "Argentina",
  cuil: "20-90000001-5",
  fecha_nacimiento: "1990-01-01",
};
const GRUPO_B = {
  calle_altura: "Calle 1",
  piso_depto: "",
  localidad: "Localidad",
  partido: "Tigre",
  partido_otro: null,
  telefono_celular: "11 4444-5555",
  email_personal: "prueba@example.test",
};
const GRUPO_D = {
  grupo_sanguineo: "0+",
  alergias: "Ninguna",
  medicacion_habitual: "Ninguna",
  obra_social: "OSDE",
  numero_afiliado: "123",
  emergencia_nombre: "Contacto",
  emergencia_parentesco: "Madre",
  emergencia_domicilio: "Calle 2",
  emergencia_telefono: "11 5555-6666",
};
const laborales = (numero: string) => ({
  numero_legajo: numero,
  area: "Operaciones",
  puesto: "Chofer",
  fecha_ingreso: "2020-03-01",
  estado_laboral: "activo",
  sede: "San Martín",
  modalidad: "Presencial",
  convenio: "Camioneros",
  bruto_mensual: 850000.5,
});

function fakePdf(label: string) {
  return Buffer.from(`%PDF-1.4\n% FAKE TEST FILE - ${label}\n%%EOF\n`);
}

describe("/legajos Server Actions (Admin)", () => {
  const service = serviceClient();
  const storage = service.storage.from(DOCUMENTOS_BUCKET);
  let empleado: TestUser;
  let otro: TestUser;
  let admin: TestUser;
  const paths: string[] = [];
  // Unique per run: numero_legajo is unique across legajos.
  const run = randomUUID().slice(0, 8);

  function as(user: TestUser, role: "empleado" | "admin") {
    session.client = user.client;
    session.user = { id: user.id, email: user.email, role, cuenta: ACTIVA };
  }

  async function legajoOf(id: string) {
    const { data } = await service.from("legajos").select("*").eq("profile_id", id).single();
    return data!;
  }
  const exists = async (path: string) => (await storage.download(path)).data !== null;

  beforeAll(async () => {
    empleado = await createTestUser(service, "legajos-empleado");
    otro = await createTestUser(service, "legajos-otro");
    admin = await createTestUser(service, "legajos-admin", "admin");
    for (const user of [empleado, otro, admin]) {
      await service.from("legajos").update({ ...GRUPO_A, ...GRUPO_B, estado_civil: "soltero", tiene_hijos: false }).eq("profile_id", user.id);
    }
  });

  beforeEach(async () => {
    const legajo = await legajoOf(empleado.id);
    await service.from("solicitudes_cambio").delete().eq("legajo_id", legajo.id);
  });

  afterAll(async () => {
    session.client = null;
    session.user = null;
    if (paths.length) await storage.remove(paths);
    await deleteTestUsers(service, [empleado.id, otro.id, admin.id]);
  });

  describe("groups", () => {
    it("the Admin updates every group of an employee directly, children and group E included", async () => {
      as(admin, "admin");
      const id = empleado.id;
      expect(await actions.actualizarGrupoLegajo({ profileId: id, grupo: "A", valores: { ...GRUPO_A, nombres: "Editado" } })).toEqual({ ok: true });
      expect(await actions.actualizarGrupoLegajo({ profileId: id, grupo: "B", valores: { ...GRUPO_B, localidad: "Admin" } })).toEqual({ ok: true });
      const hijos = [{ nombre_completo: "Hija Legajos", fecha_nacimiento: "2014-04-04" }];
      expect(
        await actions.actualizarGrupoLegajo({
          profileId: id,
          grupo: "C",
          valores: { estado_civil: "casado", nombre_conyuge: "Cónyuge", tiene_hijos: true, hijos },
        }),
      ).toEqual({ ok: true });
      expect(await actions.actualizarGrupoLegajo({ profileId: id, grupo: "D", valores: GRUPO_D })).toEqual({ ok: true });
      expect(await actions.actualizarDatosLaborales({ profileId: id, valores: laborales(`E-${run}`) })).toEqual({ ok: true });

      const legajo = await legajoOf(id);
      expect(legajo).toMatchObject({
        nombres: "Editado",
        localidad: "Admin",
        estado_civil: "casado",
        tiene_hijos: true,
        grupo_sanguineo: "0+",
        numero_legajo: `E-${run}`,
        estado_laboral: "activo",
        bruto_mensual: 850000.5,
      });
      const { data: stored } = await service.from("legajo_hijos").select("nombre_completo, fecha_nacimiento").eq("legajo_id", legajo.id);
      expect(stored).toEqual(hijos);
      // No change request was created on the way.
      const { count } = await service.from("solicitudes_cambio").select("id", { count: "exact", head: true }).eq("legajo_id", legajo.id);
      expect(count).toBe(0);

      // The list reads it back, with the account state.
      const lista = await cargarListadoLegajos();
      expect(lista?.find((item) => item.profileId === id)).toMatchObject({ numeroLegajo: `E-${run}`, estadoCuenta: "activa" });
    });

    it("validates with the shared rules: a stored CUIL with a disallowed prefix is corrected here", async () => {
      await service.from("legajos").update({ cuil: "30-90000002-6" }).eq("profile_id", otro.id);
      as(admin, "admin");
      const invalid = await actions.actualizarGrupoLegajo({ profileId: otro.id, grupo: "A", valores: { ...GRUPO_A, cuil: "30-90000002-6" } });
      expect(invalid).toMatchObject({ ok: false, fieldErrors: { cuil: copy.legajo.validation.cuilPrefijo } });
      expect(await actions.actualizarGrupoLegajo({ profileId: otro.id, grupo: "A", valores: { ...GRUPO_A, cuil: "27900000028" } })).toEqual({
        ok: true,
      });
      expect((await legajoOf(otro.id)).cuil).toBe("27-90000002-8");

      const e = await actions.actualizarDatosLaborales({ profileId: otro.id, valores: { ...laborales(`X-${run}`), bruto_mensual: -1 } });
      expect(e).toMatchObject({ ok: false, fieldErrors: { bruto_mensual: copy.legajo.validation.brutoMensualNegative } });
    });

    it("a número de legajo already in use is refused on its field", async () => {
      as(admin, "admin");
      expect(await actions.actualizarDatosLaborales({ profileId: otro.id, valores: laborales(`D-${run}`) })).toEqual({ ok: true });
      expect(await actions.actualizarDatosLaborales({ profileId: empleado.id, valores: laborales(`D-${run}`) })).toMatchObject({
        ok: false,
        fieldErrors: { numero_legajo: copy.legajos.errors.numeroLegajoDuplicado },
      });
    });

    it("the Admin edits their own legajo here, group E included", async () => {
      as(admin, "admin");
      expect(await actions.actualizarDatosLaborales({ profileId: admin.id, valores: laborales(`A-${run}`) })).toEqual({ ok: true });
      expect(await actions.actualizarGrupoLegajo({ profileId: admin.id, grupo: "B", valores: { ...GRUPO_B, localidad: "Propia" } })).toEqual({
        ok: true,
      });
      expect(await legajoOf(admin.id)).toMatchObject({ numero_legajo: `A-${run}`, localidad: "Propia" });
    });

    it("the pending-request lock: A to D refused while a request is pending, group E still saved", async () => {
      const legajo = await legajoOf(empleado.id);
      const pedido = await empleado.client.rpc("crear_solicitud", {
        p_legajo_id: legajo.id,
        p_items: [{ campo: "localidad", valor_propuesto: "Pedida" }],
      });
      expect(pedido.error).toBeNull();

      as(admin, "admin");
      for (const [grupo, valores] of [["A", GRUPO_A], ["B", { ...GRUPO_B, localidad: "Bloqueada" }], ["D", GRUPO_D]] as const) {
        expect(await actions.actualizarGrupoLegajo({ profileId: empleado.id, grupo, valores }), grupo).toEqual({
          ok: false,
          error: copy.legajos.errors.solicitudPendiente,
        });
      }
      expect(
        await actions.actualizarGrupoLegajo({
          profileId: empleado.id,
          grupo: "C",
          valores: { estado_civil: "soltero", nombre_conyuge: "", tiene_hijos: false, hijos: [] },
        }),
      ).toEqual({ ok: false, error: copy.legajos.errors.solicitudPendiente });
      expect((await legajoOf(empleado.id)).localidad).not.toBe("Bloqueada");

      expect(await actions.actualizarDatosLaborales({ profileId: empleado.id, valores: laborales(`P-${run}`) })).toEqual({ ok: true });
      expect((await legajoOf(empleado.id)).numero_legajo).toBe(`P-${run}`);
    });
  });

  describe("role boundary", () => {
    it("an Empleado is refused on every action, also with another employee's id, and nothing changes", async () => {
      const antes = await legajoOf(otro.id);
      const doc = buildDocumentoPath({ profileId: otro.id, tipo: "dni_frente", fileId: randomUUID(), mimeType: "application/pdf" })!;
      for (const target of [otro.id, empleado.id]) {
        as(empleado, "empleado");
        const results = await Promise.all([
          actions.actualizarGrupoLegajo({ profileId: target, grupo: "B", valores: { ...GRUPO_B, localidad: "Intrusa" } }),
          actions.actualizarDatosLaborales({ profileId: target, valores: laborales(`I-${run}`) }),
          actions.prepararSubidaAdmin({ profileId: target, tipo: "dni_frente", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 }),
          actions.registrarDocumentoAdmin({ profileId: target, tipo: "dni_frente", path: doc, fileName: "a.pdf" }),
          actions.descartarSubidaAdmin({ profileId: target, path: doc }),
          actions.eliminarDocumentoAdmin({ profileId: target, documentoId: randomUUID() }),
          actions.obtenerUrlDocumentoAdmin({ profileId: target, documentoId: randomUUID() }),
        ]);
        for (const result of results) expect(result).toEqual(noAutorizado);
      }
      const despues = await legajoOf(otro.id);
      expect(despues.localidad).toBe(antes.localidad);
      expect(despues.numero_legajo).toBe(antes.numero_legajo);
    });

    it("without a session, everything is refused", async () => {
      session.user = null;
      expect(await actions.actualizarDatosLaborales({ profileId: otro.id, valores: laborales(`N-${run}`) })).toEqual(noAutorizado);
      expect(await actions.prepararSubidaAdmin({ profileId: otro.id, tipo: "dni_frente", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1 })).toEqual(
        noAutorizado,
      );
    });
  });

  describe("documents", () => {
    // Asks prepararSubidaAdmin for a path in the employee's folder and stores
    // the file there with the Admin's session.
    async function uploadFor(owner: TestUser, tipo: "dni_frente" | "dni_dorso" | "licencia_conducir", body: Buffer) {
      as(admin, "admin");
      const prepared = await actions.prepararSubidaAdmin({ profileId: owner.id, tipo, fileName: "doc.pdf", mimeType: "application/pdf", sizeBytes: body.length });
      expect(prepared.ok).toBe(true);
      const path = prepared.ok ? prepared.data!.path : "";
      expect(path.startsWith(`${owner.id}/${tipo}/`)).toBe(true);
      paths.push(path);
      expect((await admin.client.storage.from(DOCUMENTOS_BUCKET).upload(path, body, { contentType: "application/pdf" })).error).toBeNull();
      return path;
    }

    it("uploads for an employee as approved, replaces in place, downloads and deletes", async () => {
      const first = await uploadFor(empleado, "dni_dorso", fakePdf("admin v1"));
      expect(await actions.registrarDocumentoAdmin({ profileId: empleado.id, tipo: "dni_dorso", path: first, fileName: "v1.pdf" })).toEqual({
        ok: true,
        data: { estado: "aprobado" },
      });
      const { data: row } = await service.from("legajo_documentos").select("id, estado, uploaded_by, revisado_por").eq("storage_path", first).single();
      expect(row).toMatchObject({ estado: "aprobado", uploaded_by: admin.id, revisado_por: admin.id });

      // Replace: the same row gets the new file; the old object goes.
      const second = await uploadFor(empleado, "dni_dorso", fakePdf("admin v2"));
      expect(await actions.registrarDocumentoAdmin({ profileId: empleado.id, tipo: "dni_dorso", path: second, fileName: "v2.pdf" })).toEqual({
        ok: true,
        data: { estado: "aprobado" },
      });
      const legajo = await legajoOf(empleado.id);
      const { data: filas } = await service
        .from("legajo_documentos")
        .select("id, storage_path, file_name")
        .eq("legajo_id", legajo.id)
        .eq("tipo", "dni_dorso");
      expect(filas).toEqual([{ id: row!.id, storage_path: second, file_name: "v2.pdf" }]);
      expect(await exists(first)).toBe(false);

      as(admin, "admin");
      const url = await actions.obtenerUrlDocumentoAdmin({ profileId: empleado.id, documentoId: row!.id });
      expect(url.ok).toBe(true);
      const response = await fetch(url.ok ? url.data!.url : "");
      expect(await response.text()).toContain("FAKE TEST FILE - admin v2");
      expect(response.headers.get("content-disposition")).toContain("attachment");

      // The id must belong to the employee in the input.
      expect((await actions.obtenerUrlDocumentoAdmin({ profileId: otro.id, documentoId: row!.id })).ok).toBe(false);
      expect((await actions.eliminarDocumentoAdmin({ profileId: otro.id, documentoId: row!.id })).ok).toBe(false);

      expect(await actions.eliminarDocumentoAdmin({ profileId: empleado.id, documentoId: row!.id })).toEqual({ ok: true });
      const { count } = await service.from("legajo_documentos").select("id", { count: "exact", head: true }).eq("id", row!.id);
      expect(count).toBe(0);
      expect(await exists(second)).toBe(false);
    });

    it("shows but does not delete an employee's pending upload, and refuses a new one of that type meanwhile", async () => {
      const path = buildDocumentoPath({ profileId: empleado.id, tipo: "licencia_conducir", fileId: randomUUID(), mimeType: "application/pdf" })!;
      paths.push(path);
      await empleado.client.storage.from(DOCUMENTOS_BUCKET).upload(path, fakePdf("pendiente"), { contentType: "application/pdf" });
      const legajo = await legajoOf(empleado.id);
      const inserted = await empleado.client
        .from("legajo_documentos")
        .insert({ legajo_id: legajo.id, tipo: "licencia_conducir", storage_path: path, file_name: "l.pdf", mime_type: "application/pdf", size_bytes: 10, uploaded_by: empleado.id })
        .select("id, estado")
        .single();
      expect(inserted.data?.estado).toBe("pendiente");

      as(admin, "admin");
      expect((await actions.obtenerUrlDocumentoAdmin({ profileId: empleado.id, documentoId: inserted.data!.id })).ok).toBe(true);
      expect(await actions.eliminarDocumentoAdmin({ profileId: empleado.id, documentoId: inserted.data!.id })).toEqual({
        ok: false,
        error: copy.miLegajo.documentos.errors.eliminarFallo,
      });
      expect(
        await actions.prepararSubidaAdmin({ profileId: empleado.id, tipo: "licencia_conducir", fileName: "l.pdf", mimeType: "application/pdf", sizeBytes: 10 }),
      ).toEqual({ ok: false, error: copy.legajos.errors.documentoPendiente });
      expect(await exists(path)).toBe(true);
    });

    it("descartarSubidaAdmin removes a rowless upload in the employee's folder, never a registered one", async () => {
      const loose = await uploadFor(otro, "dni_frente", fakePdf("loose"));
      as(admin, "admin");
      expect(await actions.descartarSubidaAdmin({ profileId: otro.id, path: loose })).toEqual({ ok: true });
      expect(await exists(loose)).toBe(false);

      const kept = await uploadFor(otro, "dni_frente", fakePdf("kept"));
      expect((await actions.registrarDocumentoAdmin({ profileId: otro.id, tipo: "dni_frente", path: kept, fileName: "k.pdf" })).ok).toBe(true);
      expect(await actions.descartarSubidaAdmin({ profileId: otro.id, path: kept })).toEqual({ ok: true });
      expect(await exists(kept)).toBe(true);
      // A path of another employee than the one in the input is refused.
      expect((await actions.descartarSubidaAdmin({ profileId: empleado.id, path: kept })).ok).toBe(false);
      expect(await exists(kept)).toBe(true);
    });

    it("the Admin sweep touches only the target employee's folder", async () => {
      const orphan = (user: TestUser) =>
        buildDocumentoPath({ profileId: user.id, tipo: "dni_dorso", fileId: randomUUID(), mimeType: "application/pdf" })!;
      const target = orphan(empleado);
      const foreign = orphan(otro);
      const own = orphan(admin);
      for (const [user, path] of [[empleado, target], [otro, foreign], [admin, own]] as const) {
        paths.push(path);
        expect((await user.client.storage.from(DOCUMENTOS_BUCKET).upload(path, fakePdf("orphan"), { contentType: "application/pdf" })).error).toBeNull();
      }

      // As the Admin, an hour later, for the target employee only.
      const later = new Date(Date.now() + 60 * 60 * 1000);
      const barrido = await barrerHuerfanos(admin.client, empleado.id, { now: later });
      expect(barrido.ok && barrido.eliminados >= 1).toBe(true);
      expect(await exists(target)).toBe(false);
      expect(await exists(foreign)).toBe(true);
      expect(await exists(own)).toBe(true);
    });
  });
});
