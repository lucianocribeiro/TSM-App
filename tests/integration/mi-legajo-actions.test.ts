import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { barrerHuerfanos } from "@/lib/documentos/limpieza";
import { buildDocumentoPath } from "@/lib/documentos/paths";
import { DOCUMENTOS_BUCKET } from "@/lib/documentos/tipos";
import { createTestUser, deleteTestUsers, serviceClient, type TestUser } from "./helpers";

// The /mi-legajo Server Actions against the local stack. The session-bound
// server client is replaced by the signed-in test user's client, and the
// session user by that user, so RLS and the storage policies decide as in the
// app.
const session = vi.hoisted(() => ({
  client: null as unknown,
  user: null as null | { id: string; email: string; role: "empleado" | "admin"; cuenta: unknown },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));

const actions = await import("@/app/(app)/mi-legajo/actions");

const t = copy.miLegajo;
const ACTIVA = { estadoCuenta: "activa", debeCambiarPassword: false };

const LEGAJO = {
  nombres: "Prueba",
  apellido: "MiLegajo",
  dni: "94000001",
  nacionalidad: "Argentina",
  cuil: "20-90000001-5",
  fecha_nacimiento: "1990-01-01",
  calle_altura: "Calle 1",
  localidad: "Localidad",
  partido: "Tigre",
  telefono_celular: "11 4444-5555",
  email_personal: "prueba@example.test",
  estado_civil: "soltero" as const,
  tiene_hijos: false,
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

function fakePdf(label: string) {
  return Buffer.from(`%PDF-1.4\n% FAKE TEST FILE - ${label}\n%%EOF\n`);
}

describe("/mi-legajo Server Actions", () => {
  const service = serviceClient();
  let empleado: TestUser;
  let otro: TestUser;
  let admin: TestUser;
  let legajoEmpleado: string;
  const employeeIds: string[] = [];
  const paths: string[] = [];

  function as(user: TestUser, role: "empleado" | "admin" = "empleado") {
    session.client = user.client;
    session.user = { id: user.id, email: user.email, role, cuenta: ACTIVA };
  }

  async function legajoOf(id: string) {
    const { data } = await service.from("legajos").select("*").eq("profile_id", id).single();
    return data!;
  }

  beforeAll(async () => {
    empleado = await createTestUser(service, "mi-legajo-empleado");
    otro = await createTestUser(service, "mi-legajo-otro");
    admin = await createTestUser(service, "mi-legajo-admin", "admin");
    employeeIds.push(empleado.id, otro.id);
    for (const user of [empleado, otro, admin]) {
      await service.from("legajos").update(LEGAJO).eq("profile_id", user.id);
    }
    legajoEmpleado = (await legajoOf(empleado.id)).id;
  });

  beforeEach(async () => {
    await service.from("solicitudes_cambio").delete().eq("legajo_id", legajoEmpleado);
  });

  afterAll(async () => {
    session.client = null;
    session.user = null;
    if (paths.length) await service.storage.from(DOCUMENTOS_BUCKET).remove(paths);
    await deleteTestUsers(service, [...employeeIds, admin.id]);
  });

  describe("enviarSolicitud", () => {
    it("creates a pending request with only the changed fields of the group", async () => {
      as(empleado);
      const result = await actions.enviarSolicitud({ grupo: "B", valores: { ...GRUPO_B, telefono_celular: "11 5555-0000" } });
      expect(result).toEqual({ ok: true });
      const { data } = await service
        .from("solicitudes_cambio")
        .select("estado, solicitudes_cambio_items (campo, valor_propuesto, valor_anterior)")
        .eq("legajo_id", legajoEmpleado);
      expect(data).toEqual([
        {
          estado: "pendiente",
          solicitudes_cambio_items: [{ campo: "telefono_celular", valor_propuesto: "11 5555-0000", valor_anterior: "11 4444-5555" }],
        },
      ]);
      // The legajo itself is unchanged.
      expect((await legajoOf(empleado.id)).telefono_celular).toBe("11 4444-5555");
    });

    it("refuses when nothing changed, and when a request is already pending", async () => {
      as(empleado);
      expect(await actions.enviarSolicitud({ grupo: "B", valores: GRUPO_B })).toEqual({
        ok: false,
        error: copy.aprobaciones.errors.sinCambios,
      });
      await actions.enviarSolicitud({ grupo: "B", valores: { ...GRUPO_B, telefono_celular: "11 5555-0000" } });
      expect(await actions.enviarSolicitud({ grupo: "B", valores: { ...GRUPO_B, localidad: "Otra" } })).toEqual({
        ok: false,
        error: copy.aprobaciones.errors.solicitudPendiente,
      });
    });

    it("returns field errors and creates nothing when the values are invalid", async () => {
      as(empleado);
      const result = await actions.enviarSolicitud({
        grupo: "A",
        valores: { ...LEGAJO, cuil: "20-90000001-6", dni: "94A", fecha_nacimiento: "2999-01-01" },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(t.errors.revisarCampos);
      expect(result.fieldErrors).toMatchObject({
        cuil: copy.legajo.validation.cuilDigito,
        dni: copy.legajo.validation.dniDigits,
        fecha_nacimiento: copy.legajo.validation.fechaFutura,
      });
      const { count } = await service.from("solicitudes_cambio").select("id", { count: "exact", head: true }).eq("legajo_id", legajoEmpleado);
      expect(count).toBe(0);
    });

    it("sends the children as one field", async () => {
      as(empleado);
      const hijos = [
        { nombre_completo: "Hija Uno", fecha_nacimiento: "2015-01-01" },
        { nombre_completo: "Hijo Dos", fecha_nacimiento: "2018-02-02" },
      ];
      const result = await actions.enviarSolicitud({
        grupo: "C",
        valores: { estado_civil: "soltero", nombre_conyuge: "", tiene_hijos: true, hijos },
      });
      expect(result).toEqual({ ok: true });
      const { data } = await service
        .from("solicitudes_cambio_items")
        .select("campo, valor_propuesto, solicitudes_cambio!inner(legajo_id)")
        .eq("solicitudes_cambio.legajo_id", legajoEmpleado);
      expect(data?.map((item) => item.campo).sort()).toEqual(["hijos", "tiene_hijos"]);
    });

    it("is for employees only: an Admin is told to save directly", async () => {
      as(admin, "admin");
      expect(await actions.enviarSolicitud({ grupo: "B", valores: GRUPO_B })).toEqual({ ok: false, error: t.errors.soloEmpleados });
    });
  });

  describe("cancelarSolicitud", () => {
    it("cancels the own pending request and not someone else's", async () => {
      as(empleado);
      await actions.enviarSolicitud({ grupo: "B", valores: { ...GRUPO_B, localidad: "Cancelada" } });
      const { data } = await service.from("solicitudes_cambio").select("id").eq("legajo_id", legajoEmpleado).single();

      as(otro);
      expect(await actions.cancelarSolicitud({ solicitudId: data!.id })).toEqual({
        ok: false,
        error: copy.aprobaciones.errors.noPendiente,
      });

      as(empleado);
      expect(await actions.cancelarSolicitud({ solicitudId: data!.id })).toEqual({ ok: true });
      const { data: after } = await service.from("solicitudes_cambio").select("estado").eq("id", data!.id).single();
      expect(after?.estado).toBe("cancelada");
    });
  });

  describe("actualizarLegajoPropio (Admin)", () => {
    it("updates the Admin's own legajo directly, with no request, and replaces the children", async () => {
      as(admin, "admin");
      const result = await actions.actualizarLegajoPropio({ grupo: "B", valores: { ...GRUPO_B, localidad: "Directa" } });
      expect(result).toEqual({ ok: true });
      const legajo = await legajoOf(admin.id);
      expect(legajo.localidad).toBe("Directa");
      const { count } = await service.from("solicitudes_cambio").select("id", { count: "exact", head: true }).eq("legajo_id", legajo.id);
      expect(count).toBe(0);

      const hijos = [{ nombre_completo: "Hijo Admin", fecha_nacimiento: "2016-06-06" }];
      expect(
        await actions.actualizarLegajoPropio({ grupo: "C", valores: { estado_civil: "casado", nombre_conyuge: "X", tiene_hijos: true, hijos } }),
      ).toEqual({ ok: true });
      const { data: stored } = await service.from("legajo_hijos").select("nombre_completo, fecha_nacimiento").eq("legajo_id", legajo.id);
      expect(stored).toEqual(hijos);
    });

    it("refuses an Empleado", async () => {
      as(empleado);
      expect(await actions.actualizarLegajoPropio({ grupo: "B", valores: GRUPO_B })).toEqual({ ok: false, error: t.errors.soloAdmin });
      expect((await legajoOf(empleado.id)).localidad).toBe("Localidad");
    });
  });

  describe("documents", () => {
    // Declares a PDF to prepararSubidaDocumento, then stores the body with
    // storedType (normally the same; different to test the stored-object check).
    async function uploadAs(user: TestUser, tipo: "dni_frente" | "dni_dorso" | "licencia_conducir", body: Buffer, storedType = "application/pdf") {
      as(user);
      const prepared = await actions.prepararSubidaDocumento({ tipo, fileName: "doc.pdf", mimeType: "application/pdf", sizeBytes: body.length });
      expect(prepared.ok).toBe(true);
      const path = prepared.ok ? prepared.data!.path : "";
      paths.push(path);
      const uploaded = await user.client.storage.from(DOCUMENTOS_BUCKET).upload(path, body, { contentType: storedType });
      expect(uploaded.error).toBeNull();
      return path;
    }

    it("records an Empleado's upload as pending; downloads and deletes it", async () => {
      const path = await uploadAs(empleado, "dni_frente", fakePdf("empleado"));
      const registered = await actions.registrarDocumento({ tipo: "dni_frente", path, fileName: "dni.pdf" });
      expect(registered).toEqual({ ok: true, data: { estado: "pendiente" } });

      const { data: doc } = await service.from("legajo_documentos").select("id, size_bytes").eq("storage_path", path).single();
      expect(doc?.size_bytes).toBe(fakePdf("empleado").length);

      const url = await actions.obtenerUrlDocumento({ documentoId: doc!.id });
      expect(url.ok).toBe(true);
      const response = await fetch(url.ok ? url.data!.url : "");
      expect(await response.text()).toContain("FAKE TEST FILE - empleado");

      // A second pending upload of the same type is refused before any upload.
      as(empleado);
      expect(await actions.prepararSubidaDocumento({ tipo: "dni_frente", fileName: "b.pdf", mimeType: "application/pdf", sizeBytes: 10 })).toEqual({
        ok: false,
        error: copy.aprobaciones.errors.documentoPendiente,
      });

      expect(await actions.eliminarDocumentoPendiente({ documentoId: doc!.id })).toEqual({ ok: true });
      const { count } = await service.from("legajo_documentos").select("id", { count: "exact", head: true }).eq("id", doc!.id);
      expect(count).toBe(0);
      expect((await service.storage.from(DOCUMENTOS_BUCKET).download(path)).data).toBeNull();
    });

    it("validates the declared file before any upload", async () => {
      as(empleado);
      const big = await actions.prepararSubidaDocumento({ tipo: "dni_dorso", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 * 1024 * 1024 + 1 });
      expect(big).toEqual({ ok: false, error: copy.documentos.validation.fileTooLarge });
      const html = await actions.prepararSubidaDocumento({ tipo: "dni_dorso", fileName: "a.html", mimeType: "text/html", sizeBytes: 10 });
      expect(html).toEqual({ ok: false, error: copy.documentos.validation.fileTypeNotAllowed });
    });

    it("checks the stored object, not the declaration, and removes it when it does not match", async () => {
      // Declared as a PDF, stored as a PNG under the .pdf path.
      const path = await uploadAs(empleado, "dni_dorso", Buffer.from("not a pdf"), "image/png");
      const result = await actions.registrarDocumento({ tipo: "dni_dorso", path, fileName: "dni.pdf" });
      expect(result.ok).toBe(false);
      expect((await service.storage.from(DOCUMENTOS_BUCKET).download(path)).data).toBeNull();
      const { count } = await service.from("legajo_documentos").select("id", { count: "exact", head: true }).eq("storage_path", path);
      expect(count).toBe(0);
    });

    it("refuses a path in another user's folder or of another type", async () => {
      as(empleado);
      const foreign = buildDocumentoPath({ profileId: otro.id, tipo: "dni_frente", fileId: randomUUID(), mimeType: "application/pdf" })!;
      expect((await actions.registrarDocumento({ tipo: "dni_frente", path: foreign, fileName: "x.pdf" })).ok).toBe(false);
      const own = buildDocumentoPath({ profileId: empleado.id, tipo: "dni_frente", fileId: randomUUID(), mimeType: "application/pdf" })!;
      expect((await actions.registrarDocumento({ tipo: "dni_dorso", path: own, fileName: "x.pdf" })).ok).toBe(false);
    });

    it("never reaches another user's document, even for an Admin", async () => {
      const path = await uploadAs(otro, "licencia_conducir", fakePdf("otro"));
      expect((await actions.registrarDocumento({ tipo: "licencia_conducir", path, fileName: "l.pdf" })).ok).toBe(true);
      const { data: doc } = await service.from("legajo_documentos").select("id").eq("storage_path", path).single();

      for (const [user, role] of [[empleado, "empleado"], [admin, "admin"]] as const) {
        as(user, role);
        expect((await actions.obtenerUrlDocumento({ documentoId: doc!.id })).ok, role).toBe(false);
        expect((await actions.eliminarDocumentoPendiente({ documentoId: doc!.id })).ok, role).toBe(false);
      }
      const { count } = await service.from("legajo_documentos").select("id", { count: "exact", head: true }).eq("id", doc!.id);
      expect(count).toBe(1);
    });

    it("the orphan sweep removes only the caller's own old rowless objects", async () => {
      const storage = service.storage.from(DOCUMENTOS_BUCKET);
      const orphan = (user: TestUser) =>
        buildDocumentoPath({ profileId: user.id, tipo: "licencia_conducir", fileId: randomUUID(), mimeType: "application/pdf" })!;

      // The employee: an abandoned upload and a registered document.
      const own = orphan(empleado);
      paths.push(own);
      expect((await empleado.client.storage.from(DOCUMENTOS_BUCKET).upload(own, fakePdf("orphan"), { contentType: "application/pdf" })).error).toBeNull();
      const registered = await uploadAs(empleado, "dni_dorso", fakePdf("registered"));
      expect((await actions.registrarDocumento({ tipo: "dni_dorso", path: registered, fileName: "d.pdf" })).ok).toBe(true);
      // Another employee's abandoned upload.
      const foreign = orphan(otro);
      paths.push(foreign);
      expect((await otro.client.storage.from(DOCUMENTOS_BUCKET).upload(foreign, fakePdf("foreign"), { contentType: "application/pdf" })).error).toBeNull();

      const exists = async (path: string) => (await storage.download(path)).data !== null;

      // Everything is fresh: nothing goes.
      expect((await barrerHuerfanos(empleado.client, empleado.id)).ok).toBe(true);
      expect(await exists(own)).toBe(true);

      // An hour later, as the employee: only their own orphan goes.
      const later = new Date(Date.now() + 60 * 60 * 1000);
      const barrido = await barrerHuerfanos(empleado.client, empleado.id, { now: later });
      expect(barrido.ok && barrido.eliminados >= 1).toBe(true);
      expect(await exists(own)).toBe(false);
      expect(await exists(registered)).toBe(true);
      expect(await exists(foreign)).toBe(true);

      // Even pointed at another folder, the employee's session reaches nothing there.
      expect(await barrerHuerfanos(empleado.client, otro.id, { now: later })).toEqual({ ok: true, eliminados: 0 });
      expect(await exists(foreign)).toBe(true);
    });

    it("descartarSubida removes a rowless upload but never a registered document", async () => {
      const registered = await uploadAs(empleado, "licencia_conducir", fakePdf("keep"));
      expect((await actions.registrarDocumento({ tipo: "licencia_conducir", path: registered, fileName: "l.pdf" })).ok).toBe(true);
      as(empleado);
      expect(await actions.descartarSubida({ path: registered })).toEqual({ ok: true });
      expect((await service.storage.from(DOCUMENTOS_BUCKET).download(registered)).data).not.toBeNull();

      const loose = buildDocumentoPath({ profileId: empleado.id, tipo: "dni_frente", fileId: randomUUID(), mimeType: "application/pdf" })!;
      paths.push(loose);
      await empleado.client.storage.from(DOCUMENTOS_BUCKET).upload(loose, fakePdf("loose"), { contentType: "application/pdf" });
      expect(await actions.descartarSubida({ path: loose })).toEqual({ ok: true });
      expect((await service.storage.from(DOCUMENTOS_BUCKET).download(loose)).data).toBeNull();
    });

    it("an Admin's own upload is approved at once and a second one replaces it in the chosen mode", async () => {
      const first = await uploadAs(admin, "dni_frente", fakePdf("admin v1"));
      as(admin, "admin");
      expect(await actions.registrarDocumento({ tipo: "dni_frente", path: first, fileName: "v1.pdf" })).toEqual({ ok: true, data: { estado: "aprobado" } });

      const second = await uploadAs(admin, "dni_frente", fakePdf("admin v2"));
      as(admin, "admin");
      expect(await actions.registrarDocumento({ tipo: "dni_frente", path: second, fileName: "v2.pdf", modo: "definitivo" })).toEqual({
        ok: true,
        data: { estado: "aprobado" },
      });

      const legajo = await legajoOf(admin.id);
      const { data } = await service.from("legajo_documentos").select("storage_path, file_name").eq("legajo_id", legajo.id).eq("tipo", "dni_frente");
      expect(data).toEqual([{ storage_path: second, file_name: "v2.pdf" }]);
      expect((await service.storage.from(DOCUMENTOS_BUCKET).download(first)).data).toBeNull();
    });
  });

  it("refuses everything without an active session", async () => {
    session.user = null;
    const no = { ok: false, error: copy.cuentas.errors.noAutorizado };
    expect(await actions.enviarSolicitud({ grupo: "B", valores: GRUPO_B })).toEqual(no);
    expect(await actions.cancelarSolicitud({ solicitudId: randomUUID() })).toEqual(no);
    expect(await actions.prepararSubidaDocumento({ tipo: "dni_frente", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1 })).toEqual(no);
    expect(await actions.registrarDocumento({ tipo: "dni_frente", path: "x", fileName: "a.pdf" })).toEqual(no);
    expect(await actions.eliminarDocumentoPendiente({ documentoId: randomUUID() })).toEqual(no);
    expect(await actions.obtenerUrlDocumento({ documentoId: randomUUID() })).toEqual(no);
  });
});
