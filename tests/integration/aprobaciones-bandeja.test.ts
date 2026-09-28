import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { buildDocumentoPath } from "@/lib/documentos/paths";
import { DOCUMENTOS_BUCKET, type DocumentoTipo } from "@/lib/documentos/tipos";
import { anonClient, createTestUser, deleteTestUsers, serviceClient, type TestUser, type TypedClient } from "./helpers";

// F1-09B against the local stack: the database-enforced pending-request
// lock, the Admin replacement function, the replaced history's visibility,
// the own-account rule on decisions, and the /aprobaciones and /legajos
// actions end to end. As in legajos-admin-actions.test.ts, the session-bound
// server client is the signed-in test user's client, so RLS decides as in
// the app.
const session = vi.hoisted(() => ({
  client: null as unknown,
  user: null as null | { id: string; email: string; role: "empleado" | "admin"; cuenta: unknown },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));

const bandeja = await import("@/app/(app)/aprobaciones/actions");
const legajos = await import("@/app/(app)/legajos/actions");
const { cargarMiLegajo } = await import("@/lib/legajo/mi-legajo");

const ACTIVA = { estadoCuenta: "activa", debeCambiarPassword: false };
const noAutorizado = { ok: false, error: copy.cuentas.errors.noAutorizado };
const OBJECT_STATE = "55000";

const GRUPOS_A_D = {
  nombres: "Prueba",
  apellido: "Bandeja",
  dni: "12345678",
  nacionalidad: "Argentina",
  cuil: "20-12345678-6",
  fecha_nacimiento: "1990-01-01",
  calle_altura: "Calle 1",
  piso_depto: null,
  localidad: "Localidad",
  partido: "Tigre",
  partido_otro: null,
  telefono_celular: "11 4444-5555",
  email_personal: "prueba@example.test",
  estado_civil: "soltero" as const,
  nombre_conyuge: null,
  tiene_hijos: true,
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

function fakePdf(label: string) {
  return Buffer.from(`%PDF-1.4\n% FAKE TEST FILE - ${label}\n%%EOF\n`);
}

describe("F1-09B: lock, replacement, history and the approvals inbox", () => {
  const service = serviceClient();
  const storage = service.storage.from(DOCUMENTOS_BUCKET);
  let empleado: TestUser;
  let otro: TestUser;
  let admin: TestUser;
  let legajo: string;
  let legajoOtro: string;
  const paths: string[] = [];

  function as(user: TestUser, role: "empleado" | "admin") {
    session.client = user.client;
    session.user = { id: user.id, email: user.email, role, cuenta: ACTIVA };
  }

  async function legajoIdOf(profileId: string) {
    const { data } = await service.from("legajos").select("id").eq("profile_id", profileId).single();
    return data!.id;
  }
  async function storedLegajo(id: string) {
    const { data } = await service.from("legajos").select("*").eq("id", id).single();
    return data!;
  }
  async function storedHijos(id: string) {
    const { data } = await service.from("legajo_hijos").select("id, nombre_completo").eq("legajo_id", id).order("nombre_completo");
    return data ?? [];
  }
  async function estadoSolicitud(id: string) {
    const { data } = await service.from("solicitudes_cambio").select("estado, motivo_rechazo").eq("id", id).single();
    return data!;
  }
  async function crearSolicitud(client: TypedClient, legajoId: string, items: { campo: string; valor_propuesto: string | null }[]) {
    const { data, error } = await client.rpc("crear_solicitud", { p_legajo_id: legajoId, p_items: items });
    expect(error).toBeNull();
    return data!;
  }
  const newPath = (owner: string, tipo: DocumentoTipo, ext: "pdf" | "png" = "pdf") =>
    buildDocumentoPath({ profileId: owner, tipo, fileId: randomUUID(), mimeType: ext === "pdf" ? "application/pdf" : "image/png" })!;
  const exists = async (path: string) => (await storage.download(path)).data !== null;

  // An object plus its row, set up with the service role.
  async function documento(
    owner: TestUser,
    legajoId: string,
    tipo: DocumentoTipo,
    estado: "aprobado" | "pendiente",
    label: string,
  ) {
    const path = newPath(owner.id, tipo);
    paths.push(path);
    const body = fakePdf(label);
    expect((await storage.upload(path, body, { contentType: "application/pdf" })).error).toBeNull();
    const review = estado === "aprobado" ? { revisado_por: admin.id, revisado_en: new Date().toISOString() } : {};
    const { data, error } = await service
      .from("legajo_documentos")
      .insert({
        legajo_id: legajoId,
        tipo,
        storage_path: path,
        file_name: `${label}.pdf`,
        mime_type: "application/pdf",
        size_bytes: body.length,
        uploaded_by: estado === "aprobado" ? admin.id : owner.id,
        estado,
        ...review,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    return { id: data!.id, path };
  }

  async function docsDe(legajoId: string, tipo: DocumentoTipo) {
    const { data } = await service
      .from("legajo_documentos")
      .select("id, estado, storage_path, reemplazado_por, reemplazado_en")
      .eq("legajo_id", legajoId)
      .eq("tipo", tipo)
      .order("created_at");
    return data ?? [];
  }

  beforeAll(async () => {
    empleado = await createTestUser(service, "bandeja-empleado");
    otro = await createTestUser(service, "bandeja-otro");
    admin = await createTestUser(service, "bandeja-admin", "admin");
    legajo = await legajoIdOf(empleado.id);
    legajoOtro = await legajoIdOf(otro.id);
    for (const id of [legajo, legajoOtro]) {
      await service.from("legajos").update(GRUPOS_A_D).eq("id", id);
      await service.from("legajo_hijos").insert({ legajo_id: id, nombre_completo: "Hijo Inicial", fecha_nacimiento: "2015-05-05" });
    }
  });

  beforeEach(async () => {
    // The service role is not locked: it resets the test data freely.
    await service.from("solicitudes_cambio").delete().in("legajo_id", [legajo, legajoOtro]);
    await service.from("legajo_documentos").delete().in("legajo_id", [legajo, legajoOtro]);
  });

  afterAll(async () => {
    session.client = null;
    session.user = null;
    if (paths.length) await storage.remove(paths);
    await deleteTestUsers(service, [empleado.id, otro.id, admin.id]);
  });

  // -------------------------------------------------------------------------
  describe("pending-request lock (database)", () => {
    it("refuses Admin writes to groups A to D and the children through PostgREST; group E still works", async () => {
      await crearSolicitud(empleado.client, legajo, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      const antes = await storedLegajo(legajo);

      for (const update of [{ nombres: "Directo" }, { alergias: "Directo" }, { cuil: "27-90000002-8" }, { tiene_hijos: false }]) {
        const { data, error } = await admin.client.from("legajos").update(update).eq("id", legajo).select();
        expect(error?.code, JSON.stringify(update)).toBe(OBJECT_STATE);
        expect(error?.hint).toBe("solicitud_pendiente");
        expect(data).toBeNull();
      }

      const laboral = await admin.client.from("legajos").update({ area: "Área F1-09B", puesto: "Puesto" }).eq("id", legajo).select("area");
      expect(laboral.error).toBeNull();
      expect(laboral.data).toEqual([{ area: "Área F1-09B" }]);

      const [hijo] = await storedHijos(legajo);
      const insert = await admin.client.from("legajo_hijos").insert({ legajo_id: legajo, nombre_completo: "Nuevo", fecha_nacimiento: "2020-01-01" });
      expect(insert.error?.code).toBe(OBJECT_STATE);
      const update = await admin.client.from("legajo_hijos").update({ nombre_completo: "Cambiado" }).eq("id", hijo.id).select();
      expect(update.error?.code).toBe(OBJECT_STATE);
      const removed = await admin.client.from("legajo_hijos").delete().eq("id", hijo.id).select();
      expect(removed.error?.code).toBe(OBJECT_STATE);

      const despues = await storedLegajo(legajo);
      expect({ ...despues, area: antes.area, puesto: antes.puesto, updated_at: antes.updated_at }).toEqual(antes);
      expect(await storedHijos(legajo)).toEqual([hijo]);

      // Another employee's legajo, with nothing pending, is not affected.
      const libre = await admin.client.from("legajos").update({ nombres: "Libre" }).eq("id", legajoOtro).select("nombres");
      expect(libre.data).toEqual([{ nombres: "Libre" }]);
      await service.from("legajos").update({ nombres: GRUPOS_A_D.nombres }).eq("id", legajoOtro);
    });

    it("aprobar_solicitud still applies the request, children included, and the lock releases", async () => {
      const hijos = JSON.stringify([{ nombre_completo: "Hija Aprobada", fecha_nacimiento: "2019-09-09" }]);
      const id = await crearSolicitud(empleado.client, legajo, [
        { campo: "nombres", valor_propuesto: "Aprobado" },
        { campo: "hijos", valor_propuesto: hijos },
      ]);
      expect((await admin.client.rpc("aprobar_solicitud", { p_solicitud_id: id })).error).toBeNull();
      expect((await storedLegajo(legajo)).nombres).toBe("Aprobado");
      expect((await storedHijos(legajo)).map((hijo) => hijo.nombre_completo)).toEqual(["Hija Aprobada"]);

      const libre = await admin.client.from("legajos").update({ nombres: GRUPOS_A_D.nombres }).eq("id", legajo).select("nombres");
      expect(libre.error).toBeNull();
      expect(libre.data).toEqual([{ nombres: GRUPOS_A_D.nombres }]);
      const hijo = await admin.client.from("legajo_hijos").insert({ legajo_id: legajo, nombre_completo: "Hijo Inicial", fecha_nacimiento: "2015-05-05" });
      expect(hijo.error).toBeNull();
    });

    it("rechazar_solicitud and the employee's own cancellation release it too", async () => {
      const rechazada = await crearSolicitud(empleado.client, legajo, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      expect((await admin.client.rpc("rechazar_solicitud", { p_solicitud_id: rechazada, p_motivo: "No" })).error).toBeNull();
      expect((await admin.client.from("legajos").update({ alergias: "Ninguna" }).eq("id", legajo).select("id")).error).toBeNull();

      const cancelada = await crearSolicitud(empleado.client, legajo, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      await empleado.client.from("solicitudes_cambio").update({ estado: "cancelada" }).eq("id", cancelada);
      expect((await estadoSolicitud(cancelada)).estado).toBe("cancelada");
      expect((await admin.client.from("legajos").update({ alergias: "Ninguna" }).eq("id", legajo).select("id")).error).toBeNull();
    });

    it("the lock cannot be lifted by a client", async () => {
      const id = await crearSolicitud(empleado.client, legajo, [{ campo: "alergias", valor_propuesto: "Polen" }]);

      // No direct state change for the Admin, nor 'aprobada' for the employee.
      expect((await admin.client.from("solicitudes_cambio").update({ estado: "cancelada" }).eq("id", id).select()).data).toEqual([]);
      const flip = await empleado.client.from("solicitudes_cambio").update({ estado: "aprobada" }).eq("id", id).select();
      expect(flip.error).not.toBeNull();
      // The internal check and the configuration functions are not callable.
      expect((await admin.client.rpc("hay_solicitud_pendiente" as never, { p_legajo_id: legajo } as never)).error).not.toBeNull();
      expect((await admin.client.rpc("set_config" as never, { setting_name: "x", new_value: "y", is_local: true } as never)).error).not.toBeNull();

      expect((await estadoSolicitud(id)).estado).toBe("pendiente");
      const still = await admin.client.from("legajos").update({ nombres: "Directo" }).eq("id", legajo).select();
      expect(still.error?.code).toBe(OBJECT_STATE);
    });
  });

  // -------------------------------------------------------------------------
  describe("own account", () => {
    it("an Admin cannot decide on a request or a document of their own legajo", async () => {
      const id = await crearSolicitud(empleado.client, legajo, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      const doc = await documento(empleado, legajo, "licencia_conducir", "pendiente", "propio");
      // Promoted after submitting.
      await service.from("profiles").update({ role: "admin" }).eq("id", empleado.id);
      try {
        for (const call of [
          empleado.client.rpc("aprobar_solicitud", { p_solicitud_id: id }),
          empleado.client.rpc("rechazar_solicitud", { p_solicitud_id: id, p_motivo: "No" }),
          empleado.client.rpc("aprobar_documento", { p_documento_id: doc.id }),
          empleado.client.rpc("rechazar_documento", { p_documento_id: doc.id, p_motivo: "No" }),
        ]) {
          const { error } = await call;
          expect(error?.code).toBe(OBJECT_STATE);
          expect(error?.hint).toBe("cuenta_propia");
        }
      } finally {
        await service.from("profiles").update({ role: "empleado" }).eq("id", empleado.id);
      }
      expect((await estadoSolicitud(id)).estado).toBe("pendiente");
    });
  });

  // -------------------------------------------------------------------------
  describe("reemplazar_documento", () => {
    const call = (client: TypedClient, path: string, conservar: boolean, over: Record<string, unknown> = {}) =>
      client.rpc("reemplazar_documento", {
        p_legajo_id: legajo,
        p_tipo: "dni_frente",
        p_storage_path: path,
        p_file_name: "nuevo.pdf",
        p_mime_type: "application/pdf",
        p_size_bytes: 100,
        p_conservar_historial: conservar,
        ...over,
      });

    it("keeping history: the previous row becomes reemplazado with who and when; one approved row", async () => {
      const previo = await documento(empleado, legajo, "dni_frente", "aprobado", "v1");
      const path = newPath(empleado.id, "dni_frente");
      const { data, error } = await call(admin.client, path, true);
      expect(error).toBeNull();
      expect(data?.[0].storage_path_eliminado).toBeNull();

      const docs = await docsDe(legajo, "dni_frente");
      expect(docs.map((doc) => [doc.id === previo.id ? "previo" : "nuevo", doc.estado])).toEqual([
        ["previo", "reemplazado"],
        ["nuevo", "aprobado"],
      ]);
      expect(docs[0].reemplazado_por).toBe(admin.id);
      expect(docs[0].reemplazado_en).not.toBeNull();
      expect(docs[1]).toMatchObject({ id: data?.[0].documento_id, storage_path: path, reemplazado_por: null });
    });

    it("replacing permanently: the previous row is deleted and its path returned", async () => {
      const previo = await documento(empleado, legajo, "dni_frente", "aprobado", "v1");
      const path = newPath(empleado.id, "dni_frente");
      const { data, error } = await call(admin.client, path, false);
      expect(error).toBeNull();
      expect(data?.[0].storage_path_eliminado).toBe(previo.path);
      expect((await docsDe(legajo, "dni_frente")).map((doc) => [doc.storage_path, doc.estado])).toEqual([[path, "aprobado"]]);
    });

    it("is atomic: a failing insert leaves the previous document as it was, in both modes", async () => {
      const previo = await documento(empleado, legajo, "dni_frente", "aprobado", "v1");
      for (const conservar of [true, false]) {
        // The path extension does not match the MIME type: the insert fails after the previous row changed.
        const { error } = await call(admin.client, newPath(empleado.id, "dni_frente", "png"), conservar);
        expect(error?.code).toBe("23514");
        expect((await docsDe(legajo, "dni_frente")).map((doc) => [doc.id, doc.estado])).toEqual([[previo.id, "aprobado"]]);
      }
    });

    it("refuses an Empleado, anon, a file outside the employee's folder, a missing mode or no current document", async () => {
      await documento(empleado, legajo, "dni_frente", "aprobado", "v1");
      expect((await call(empleado.client, newPath(empleado.id, "dni_frente"), true)).error?.code).toBe("42501");
      expect((await call(anonClient(), newPath(empleado.id, "dni_frente"), true)).error).not.toBeNull();
      expect((await call(admin.client, newPath(otro.id, "dni_frente"), true)).error?.code).toBe("22023");
      expect((await call(admin.client, newPath(empleado.id, "dni_frente"), null as unknown as boolean)).error?.code).toBe("22023");
      expect((await call(admin.client, newPath(empleado.id, "dni_dorso"), true, { p_tipo: "dni_dorso" })).error?.code).toBe("P0002");
      expect((await docsDe(legajo, "dni_frente")).map((doc) => doc.estado)).toEqual(["aprobado"]);
    });

    it("refuses while the employee has a pending document of that type", async () => {
      await documento(empleado, legajo, "dni_frente", "aprobado", "v1");
      await documento(empleado, legajo, "dni_frente", "pendiente", "enviado");
      const { error } = await call(admin.client, newPath(empleado.id, "dni_frente"), true);
      expect(error?.code).toBe(OBJECT_STATE);
      expect(error?.hint).toBe("documento_pendiente");
    });
  });

  // -------------------------------------------------------------------------
  describe("replaced history visibility", () => {
    it("the Admin lists and downloads replaced versions; the employee never sees them", async () => {
      const previo = await documento(empleado, legajo, "dni_frente", "aprobado", "historia v1");
      const nuevo = await documento(empleado, legajo, "dni_frente", "pendiente", "historia v2");
      expect((await admin.client.rpc("aprobar_documento", { p_documento_id: nuevo.id })).error).toBeNull();

      const adminRows = await admin.client.from("legajo_documentos").select("id, estado, reemplazado_por").eq("legajo_id", legajo);
      expect(adminRows.data).toContainEqual({ id: previo.id, estado: "reemplazado", reemplazado_por: admin.id });
      const adminDownload = await admin.client.storage.from(DOCUMENTOS_BUCKET).download(previo.path);
      expect(await adminDownload.data?.text()).toContain("historia v1");

      const own = await empleado.client.from("legajo_documentos").select("id, estado").eq("legajo_id", legajo);
      expect(own.error).toBeNull();
      expect(own.data).toEqual([{ id: nuevo.id, estado: "aprobado" }]);
      const bucket = empleado.client.storage.from(DOCUMENTOS_BUCKET);
      expect((await bucket.download(previo.path)).data).toBeNull();
      expect((await bucket.createSignedUrl(previo.path, 60)).data).toBeNull();
      const listed = await bucket.list(`${empleado.id}/dni_frente`);
      expect(listed.data?.map((entry) => `${empleado.id}/dni_frente/${entry.name}`)).not.toContain(previo.path);
      expect(listed.data?.map((entry) => `${empleado.id}/dni_frente/${entry.name}`)).toContain(nuevo.path);
      // Hidden, but not an orphan the employee may remove or overwrite.
      expect((await bucket.remove([previo.path])).data ?? []).toEqual([]);
      expect((await bucket.update(previo.path, fakePdf("sobrescrito"), { contentType: "application/pdf" })).error).not.toBeNull();
      expect(await exists(previo.path)).toBe(true);

      // Mi Legajo, read as the employee, has no replaced row either.
      as(empleado, "empleado");
      const mio = await cargarMiLegajo(empleado.id);
      expect(mio?.documentos.map((doc) => doc.estado)).toEqual(["aprobado"]);
    });
  });

  // -------------------------------------------------------------------------
  describe("/aprobaciones actions", () => {
    it("refuse an Empleado on every action, with own or another employee's ids, and nothing changes", async () => {
      const solicitudOtro = await crearSolicitud(otro.client, legajoOtro, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      const docOtro = await documento(otro, legajoOtro, "dni_dorso", "pendiente", "otro");
      const solicitudPropia = await crearSolicitud(empleado.client, legajo, [{ campo: "alergias", valor_propuesto: "Ácaros" }]);

      as(empleado, "empleado");
      for (const [solicitudId, documentoId] of [
        [solicitudOtro, docOtro.id],
        [solicitudPropia, docOtro.id],
      ]) {
        const results = await Promise.all([
          bandeja.aprobarSolicitud({ solicitudId }),
          bandeja.rechazarSolicitud({ solicitudId, motivo: "Intruso" }),
          bandeja.aprobarDocumento({ documentoId }),
          bandeja.rechazarDocumento({ documentoId, motivo: "Intruso" }),
          bandeja.descargarDocumentoBandeja({ documentoId }),
          bandeja.contarPendientesCampana(),
        ]);
        for (const result of results) expect(result).toEqual(noAutorizado);
      }
      expect((await estadoSolicitud(solicitudOtro)).estado).toBe("pendiente");
      expect((await estadoSolicitud(solicitudPropia)).estado).toBe("pendiente");
      expect((await docsDe(legajoOtro, "dni_dorso")).map((doc) => doc.estado)).toEqual(["pendiente"]);
    });

    it("approve a request: the legajo changes and the employee sees it approved in Mi Legajo", async () => {
      const id = await crearSolicitud(empleado.client, legajo, [{ campo: "telefono_celular", valor_propuesto: "11 2222-3333" }]);
      as(admin, "admin");
      const antes = await bandeja.contarPendientesCampana();
      expect(await bandeja.aprobarSolicitud({ solicitudId: id })).toEqual({ ok: true });
      const despues = await bandeja.contarPendientesCampana();
      expect(despues.ok && antes.ok && despues.data!.total).toBe(antes.ok ? antes.data!.total - 1 : NaN);
      expect((await storedLegajo(legajo)).telefono_celular).toBe("11 2222-3333");

      as(empleado, "empleado");
      const mio = await cargarMiLegajo(empleado.id);
      expect(mio?.solicitud).toMatchObject({ id, estado: "aprobada" });

      // A second decision on the same request: controlled, not a raw error.
      as(admin, "admin");
      expect(await bandeja.rechazarSolicitud({ solicitudId: id, motivo: "Tarde" })).toEqual({
        ok: false,
        error: copy.aprobaciones.errors.yaDecidido,
        yaDecidido: true,
      });
    });

    it("reject a request: the employee sees the reason verbatim", async () => {
      const id = await crearSolicitud(empleado.client, legajo, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      as(admin, "admin");
      expect(await bandeja.rechazarSolicitud({ solicitudId: id, motivo: "  Falta el certificado médico.  " })).toEqual({ ok: true });
      expect((await storedLegajo(legajo)).alergias).toBe("Ninguna");
      as(empleado, "empleado");
      const mio = await cargarMiLegajo(empleado.id);
      expect(mio?.solicitud).toMatchObject({ id, estado: "rechazada", motivoRechazo: "Falta el certificado médico." });
    });

    it("refuses to approve values that no longer validate; the request stays pending", async () => {
      // The database accepts any CUIL text; the shared validators do not.
      const id = await crearSolicitud(empleado.client, legajo, [{ campo: "cuil", valor_propuesto: "30-12345678-1" }]);
      as(admin, "admin");
      const result = await bandeja.aprobarSolicitud({ solicitudId: id });
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.error).toContain(copy.aprobaciones.campos.cuil);
      expect((await estadoSolicitud(id)).estado).toBe("pendiente");
      expect((await storedLegajo(legajo)).cuil).toBe(GRUPOS_A_D.cuil);
    });

    it("approve and reject documents", async () => {
      const vigente = await documento(empleado, legajo, "dni_frente", "aprobado", "vigente");
      const enviado = await documento(empleado, legajo, "dni_frente", "pendiente", "enviado");
      const otroEnviado = await documento(empleado, legajo, "dni_dorso", "pendiente", "dorso");
      as(admin, "admin");
      expect(await bandeja.aprobarDocumento({ documentoId: enviado.id })).toEqual({ ok: true });
      expect(await bandeja.rechazarDocumento({ documentoId: otroEnviado.id, motivo: "Ilegible" })).toEqual({ ok: true });

      const frente = await docsDe(legajo, "dni_frente");
      expect(frente.map((doc) => [doc.id, doc.estado])).toEqual([
        [vigente.id, "reemplazado"],
        [enviado.id, "aprobado"],
      ]);
      as(empleado, "empleado");
      const mio = await cargarMiLegajo(empleado.id);
      expect(mio?.documentos.find((doc) => doc.id === otroEnviado.id)).toMatchObject({ estado: "rechazado", motivoRechazo: "Ilegible" });

      as(admin, "admin");
      const url = await bandeja.descargarDocumentoBandeja({ documentoId: enviado.id });
      expect(url.ok).toBe(true);
      expect(await (await fetch(url.ok ? url.data!.url : "")).text()).toContain("enviado");
    });
  });

  // -------------------------------------------------------------------------
  describe("/legajos replacement modes", () => {
    async function uploadAsAdmin(tipo: DocumentoTipo, label: string) {
      as(admin, "admin");
      const body = fakePdf(label);
      const prepared = await legajos.prepararSubidaAdmin({ profileId: empleado.id, tipo, fileName: `${label}.pdf`, mimeType: "application/pdf", sizeBytes: body.length });
      expect(prepared.ok).toBe(true);
      const path = prepared.ok ? prepared.data!.path : "";
      paths.push(path);
      expect((await admin.client.storage.from(DOCUMENTOS_BUCKET).upload(path, body, { contentType: "application/pdf" })).error).toBeNull();
      return path;
    }

    it("keeping history keeps both files; replacing permanently removes the previous object", async () => {
      const primero = await uploadAsAdmin("licencia_conducir", "lic v1");
      expect((await legajos.registrarDocumentoAdmin({ profileId: empleado.id, tipo: "licencia_conducir", path: primero, fileName: "v1.pdf" })).ok).toBe(true);

      const segundo = await uploadAsAdmin("licencia_conducir", "lic v2");
      expect(
        await legajos.registrarDocumentoAdmin({ profileId: empleado.id, tipo: "licencia_conducir", path: segundo, fileName: "v2.pdf", modo: "conservar" }),
      ).toEqual({ ok: true, data: { estado: "aprobado" } });
      expect((await docsDe(legajo, "licencia_conducir")).map((doc) => [doc.storage_path, doc.estado])).toEqual([
        [primero, "reemplazado"],
        [segundo, "aprobado"],
      ]);
      expect(await exists(primero)).toBe(true);
      expect(await exists(segundo)).toBe(true);

      const tercero = await uploadAsAdmin("licencia_conducir", "lic v3");
      expect(
        await legajos.registrarDocumentoAdmin({ profileId: empleado.id, tipo: "licencia_conducir", path: tercero, fileName: "v3.pdf", modo: "definitivo" }),
      ).toEqual({ ok: true, data: { estado: "aprobado" } });
      expect((await docsDe(legajo, "licencia_conducir")).map((doc) => [doc.storage_path, doc.estado])).toEqual([
        [primero, "reemplazado"],
        [tercero, "aprobado"],
      ]);
      expect(await exists(segundo)).toBe(false);
      expect(await exists(primero)).toBe(true);

      // The history version downloads through the Legajos action.
      const version = (await docsDe(legajo, "licencia_conducir"))[0];
      const url = await legajos.obtenerUrlDocumentoAdmin({ profileId: empleado.id, documentoId: version.id });
      expect(await (await fetch(url.ok ? url.data!.url : "")).text()).toContain("lic v1");
    });

    it("the group action still refuses with the lock message while a request is pending", async () => {
      await crearSolicitud(empleado.client, legajo, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      as(admin, "admin");
      const result = await legajos.actualizarGrupoLegajo({
        profileId: empleado.id,
        grupo: "D",
        valores: { ...GRUPOS_A_D, alergias: "Otra" },
      });
      expect(result).toEqual({ ok: false, error: copy.legajos.errors.solicitudPendiente });
    });
  });
});
