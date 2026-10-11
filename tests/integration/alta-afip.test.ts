import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { DOCUMENTOS_BUCKET } from "@/lib/documentos/tipos";
import { fakePdf, legajoIdDe, rutaDocumento } from "./actores";
import { anonClient, createTestUser, deleteTestUsers, serviceClient, type TestUser, type TypedClient } from "./helpers";

// CR-3: the Alta de AFIP document against the local stack. Only an Admin
// uploads, replaces (both modes) and deletes it, approved at once; the
// employee reads and downloads their own current one, never its replaced
// history, and writes nothing of it, through the app or straight through the
// API. It is never pending, so never in the inbox or the bell. As in
// aprobaciones-bandeja.test.ts, the session-bound server client is the
// signed-in test user's client, so RLS decides as in the app.
const session = vi.hoisted(() => ({
  client: null as unknown,
  user: null as null | { id: string; email: string; role: "empleado" | "admin"; cuenta: unknown },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));

const miLegajo = await import("@/app/(app)/mi-legajo/actions");
const legajos = await import("@/app/(app)/legajos/actions");
const { cargarBandeja } = await import("@/lib/aprobaciones/bandeja-datos");

const ACTIVA = { estadoCuenta: "activa", debeCambiarPassword: false };
const PERMISSION_DENIED = "42501";
const CHECK_VIOLATION = "23514";
const soloAdmin = { ok: false, error: copy.miLegajo.documentos.errors.soloAdmin };

describe("Alta de AFIP (CR-3)", () => {
  const service = serviceClient();
  let empleado: TestUser;
  let otro: TestUser;
  let admin: TestUser;
  let legajo: string;
  let legajoAdmin: string;
  const paths: string[] = [];

  function as(user: TestUser, role: "empleado" | "admin") {
    session.client = user.client;
    session.user = { id: user.id, email: user.email, role, cuenta: ACTIVA };
  }

  const bucket = (client: TypedClient) => client.storage.from(DOCUMENTOS_BUCKET);

  async function stored(path: string): Promise<string | null> {
    const { data } = await bucket(service).download(path);
    return data ? data.text() : null;
  }

  async function altas(legajoId: string) {
    const { data, error } = await service
      .from("legajo_documentos")
      .select("id, storage_path, estado, uploaded_by, revisado_por")
      .eq("legajo_id", legajoId)
      .eq("tipo", "alta_afip")
      .order("created_at");
    expect(error).toBeNull();
    return data ?? [];
  }

  async function pendientes() {
    const { data, error } = await admin.client.rpc("pendientes_admin");
    expect(error).toBeNull();
    return data;
  }

  // The Admin's upload through /legajos: path, file to Storage, registration.
  async function subirComoAdmin(owner: TestUser, label: string, modo?: "conservar" | "definitivo") {
    as(admin, "admin");
    const body = fakePdf(label);
    const prepared = await legajos.prepararSubidaAdmin({
      profileId: owner.id,
      tipo: "alta_afip",
      fileName: `${label}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: body.length,
    });
    expect(prepared.ok).toBe(true);
    const path = prepared.ok ? prepared.data!.path : "";
    paths.push(path);
    expect((await bucket(admin.client).upload(path, body, { contentType: "application/pdf" })).error).toBeNull();
    const registrado = await legajos.registrarDocumentoAdmin({
      profileId: owner.id,
      tipo: "alta_afip",
      path,
      fileName: `${label}.pdf`,
      ...(modo ? { modo } : {}),
    });
    expect(registrado).toEqual({ ok: true, data: { estado: "aprobado" } });
    return path;
  }

  // An object under the owner's alta_afip/ with no row (an Admin upload whose
  // registration failed), set up with the service role.
  async function huerfano(owner: TestUser, label: string) {
    const path = rutaDocumento(owner.id, "alta_afip");
    paths.push(path);
    expect((await bucket(service).upload(path, fakePdf(label), { contentType: "application/pdf" })).error).toBeNull();
    return path;
  }

  beforeAll(async () => {
    empleado = await createTestUser(service, "afip-empleado");
    otro = await createTestUser(service, "afip-otro");
    admin = await createTestUser(service, "afip-admin", "admin");
    legajo = await legajoIdDe(service, empleado.id);
    legajoAdmin = await legajoIdDe(service, admin.id);
  }, 60_000);

  afterAll(async () => {
    session.client = null;
    session.user = null;
    if (paths.length) await bucket(service).remove(paths);
    await deleteTestUsers(service, [empleado.id, otro.id, admin.id]);
  });

  describe("the Admin's full cycle", () => {
    it("uploads (approved at once), replaces keeping history, replaces permanently, downloads and deletes", async () => {
      const antes = await pendientes();

      const primero = await subirComoAdmin(empleado, "afip v1");
      expect(await altas(legajo)).toEqual([
        expect.objectContaining({ storage_path: primero, estado: "aprobado", uploaded_by: admin.id, revisado_por: admin.id }),
      ]);

      const segundo = await subirComoAdmin(empleado, "afip v2", "conservar");
      expect((await altas(legajo)).map((doc) => [doc.storage_path, doc.estado])).toEqual([
        [primero, "reemplazado"],
        [segundo, "aprobado"],
      ]);
      expect(await stored(primero)).toContain("afip v1");

      // The employee reads the current one and never the replaced history.
      const propias = await empleado.client.from("legajo_documentos").select("storage_path, estado").eq("tipo", "alta_afip");
      expect(propias.data).toEqual([{ storage_path: segundo, estado: "aprobado" }]);
      expect((await bucket(empleado.client).download(primero)).data).toBeNull();
      expect((await bucket(empleado.client).createSignedUrl(primero, 60)).data).toBeNull();

      const tercero = await subirComoAdmin(empleado, "afip v3", "definitivo");
      expect((await altas(legajo)).map((doc) => [doc.storage_path, doc.estado])).toEqual([
        [primero, "reemplazado"],
        [tercero, "aprobado"],
      ]);
      expect(await stored(segundo)).toBeNull();

      // The Admin downloads the current one and the history.
      for (const [doc, contenido] of [
        [(await altas(legajo))[0], "afip v1"],
        [(await altas(legajo))[1], "afip v3"],
      ] as const) {
        as(admin, "admin");
        const url = await legajos.obtenerUrlDocumentoAdmin({ profileId: empleado.id, documentoId: doc.id });
        expect(await (await fetch(url.ok ? url.data!.url : "")).text()).toContain(contenido);
      }

      // Never pending: the bell's counts and the inbox did not change.
      expect(await pendientes()).toEqual(antes);
      as(admin, "admin");
      const bandeja = await cargarBandeja(admin.id);
      expect(bandeja).not.toBeNull();
      expect(bandeja!.some((item) => item.clase === "documento" && item.tipo === "alta_afip")).toBe(false);

      const actual = (await altas(legajo))[1];
      as(admin, "admin");
      expect(await legajos.eliminarDocumentoAdmin({ profileId: empleado.id, documentoId: actual.id })).toEqual({ ok: true });
      expect((await altas(legajo)).map((doc) => doc.storage_path)).toEqual([primero]);
      expect(await stored(tercero)).toBeNull();

      await service.from("legajo_documentos").delete().eq("legajo_id", legajo).eq("tipo", "alta_afip");
    });

    it("an Admin manages their own Alta de AFIP from Legajos", async () => {
      const path = await subirComoAdmin(admin, "afip admin propio");
      expect((await altas(legajoAdmin)).map((doc) => [doc.storage_path, doc.estado])).toEqual([[path, "aprobado"]]);
      await service.from("legajo_documentos").delete().eq("legajo_id", legajoAdmin).eq("tipo", "alta_afip");
    });
  });

  describe("an Empleado through the API, bypassing the app", () => {
    let actual: { id: string; path: string };

    beforeAll(async () => {
      const path = await subirComoAdmin(empleado, "afip empleado");
      actual = { id: (await altas(legajo))[0].id, path };
    });

    afterAll(async () => {
      await service.from("legajo_documentos").delete().eq("legajo_id", legajo).eq("tipo", "alta_afip");
    });

    it("cannot insert an alta_afip row, even for an object of their own folder", async () => {
      const path = rutaDocumento(empleado.id, "alta_afip");
      const insert = await empleado.client.from("legajo_documentos").insert({
        legajo_id: legajo,
        tipo: "alta_afip",
        storage_path: path,
        file_name: "propia.pdf",
        mime_type: "application/pdf",
        size_bytes: 10,
        uploaded_by: empleado.id,
      });
      expect(insert.error?.code).toBe(PERMISSION_DENIED);
      expect(await altas(legajo)).toHaveLength(1);
    });

    it("cannot upload an object under their own alta_afip/", async () => {
      const path = rutaDocumento(empleado.id, "alta_afip");
      paths.push(path);
      const subida = await bucket(empleado.client).upload(path, fakePdf("propia"), { contentType: "application/pdf" });
      expect(subida.error).not.toBeNull();
      expect(await stored(path)).toBeNull();
    });

    it("cannot update or delete their own alta_afip row", async () => {
      const update = await empleado.client.from("legajo_documentos").update({ file_name: "cambiado.pdf" }).eq("id", actual.id).select("id");
      expect(update.data ?? []).toEqual([]);
      const borrado = await empleado.client.from("legajo_documentos").delete().eq("id", actual.id).select("id");
      expect(borrado.data ?? []).toEqual([]);
      expect(await altas(legajo)).toEqual([expect.objectContaining({ id: actual.id, estado: "aprobado" })]);
    });

    it("cannot overwrite, move or remove the object of their own Alta de AFIP", async () => {
      const contenido = await stored(actual.path);
      expect((await bucket(empleado.client).update(actual.path, fakePdf("pisada"), { contentType: "application/pdf" })).error).not.toBeNull();
      expect((await bucket(empleado.client).move(actual.path, rutaDocumento(empleado.id, "dni_frente"))).error).not.toBeNull();
      expect((await bucket(empleado.client).remove([actual.path])).data ?? []).toEqual([]);
      expect(await stored(actual.path)).toBe(contenido);
    });

    it("cannot touch a rowless object under their own alta_afip/, nor move a pending upload there", async () => {
      const suelto = await huerfano(empleado, "afip huerfano");
      expect((await bucket(empleado.client).remove([suelto])).data ?? []).toEqual([]);
      expect((await bucket(empleado.client).update(suelto, fakePdf("pisada"), { contentType: "application/pdf" })).error).not.toBeNull();
      expect(await stored(suelto)).toContain("afip huerfano");

      // An own rowless object of another type may be moved, but not into alta_afip/.
      const propio = rutaDocumento(empleado.id, "licencia_conducir");
      paths.push(propio);
      expect((await bucket(empleado.client).upload(propio, fakePdf("licencia"), { contentType: "application/pdf" })).error).toBeNull();
      const destino = rutaDocumento(empleado.id, "alta_afip");
      paths.push(destino);
      expect((await bucket(empleado.client).move(propio, destino)).error).not.toBeNull();
      expect(await stored(destino)).toBeNull();
      expect(await stored(propio)).toContain("licencia");
    });

    it("reads and downloads their own current Alta de AFIP", async () => {
      const propia = await empleado.client.from("legajo_documentos").select("id").eq("id", actual.id);
      expect(propia.data).toEqual([{ id: actual.id }]);
      const firmada = await bucket(empleado.client).createSignedUrl(actual.path, 60, { download: "alta.pdf" });
      expect(firmada.error).toBeNull();
      expect(await (await fetch(firmada.data!.signedUrl)).text()).toContain("afip empleado");
    });

    it("another employee and anon reach nothing of it", async () => {
      for (const client of [otro.client, anonClient()]) {
        expect((await client.from("legajo_documentos").select("id").eq("id", actual.id)).data ?? []).toEqual([]);
        expect((await bucket(client).download(actual.path)).data).toBeNull();
        expect((await bucket(client).createSignedUrl(actual.path, 60)).data).toBeNull();
        const ajeno = rutaDocumento(empleado.id, "alta_afip");
        paths.push(ajeno);
        expect((await bucket(client).upload(ajeno, fakePdf("ajeno"), { contentType: "application/pdf" })).error).not.toBeNull();
      }
    });
  });

  describe("the Mi Legajo actions refuse it for every role", () => {
    let actual: { id: string; path: string };

    beforeAll(async () => {
      const path = await subirComoAdmin(empleado, "afip acciones");
      actual = { id: (await altas(legajo))[0].id, path };
    });

    afterAll(async () => {
      await service.from("legajo_documentos").delete().eq("legajo_id", legajo).eq("tipo", "alta_afip");
    });

    it("an Empleado cannot upload, register, discard or delete it, and downloads it", async () => {
      as(empleado, "empleado");
      const archivo = { tipo: "alta_afip", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 };
      expect(await miLegajo.prepararSubidaDocumento(archivo)).toEqual(soloAdmin);

      const suelto = await huerfano(empleado, "afip suelto");
      as(empleado, "empleado");
      for (const modo of [undefined, "conservar", "definitivo"]) {
        expect(await miLegajo.registrarDocumento({ tipo: "alta_afip", path: suelto, fileName: "a.pdf", ...(modo ? { modo } : {}) })).toEqual(soloAdmin);
      }
      expect(await miLegajo.descartarSubida({ path: suelto })).toEqual(soloAdmin);
      expect(await stored(suelto)).toContain("afip suelto");

      expect(await miLegajo.eliminarDocumentoPendiente({ documentoId: actual.id })).toEqual(soloAdmin);
      expect(await altas(legajo)).toEqual([expect.objectContaining({ id: actual.id, estado: "aprobado" })]);

      const url = await miLegajo.obtenerUrlDocumento({ documentoId: actual.id });
      expect(await (await fetch(url.ok ? url.data!.url : "")).text()).toContain("afip acciones");
    });

    it("an Admin cannot upload or register their own from Mi Legajo either", async () => {
      as(admin, "admin");
      const archivo = { tipo: "alta_afip", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 };
      expect(await miLegajo.prepararSubidaDocumento(archivo)).toEqual(soloAdmin);

      const suelto = await huerfano(admin, "afip admin suelto");
      as(admin, "admin");
      expect(await miLegajo.registrarDocumento({ tipo: "alta_afip", path: suelto, fileName: "a.pdf" })).toEqual(soloAdmin);
      expect(await miLegajo.descartarSubida({ path: suelto })).toEqual(soloAdmin);
      expect(await stored(suelto)).toContain("afip admin suelto");
      expect(await altas(legajoAdmin)).toEqual([]);
    });
  });

  describe("never pending", () => {
    it("the database refuses a pending or rejected Alta de AFIP, for the service role too", async () => {
      const path = rutaDocumento(empleado.id, "alta_afip");
      const base = {
        legajo_id: legajo,
        tipo: "alta_afip" as const,
        storage_path: path,
        file_name: "a.pdf",
        mime_type: "application/pdf",
        size_bytes: 10,
        uploaded_by: admin.id,
      };
      // estado defaults to pendiente.
      expect((await service.from("legajo_documentos").insert(base)).error?.code).toBe(CHECK_VIOLATION);
      const rechazado = await service.from("legajo_documentos").insert({
        ...base,
        estado: "rechazado",
        motivo_rechazo: "Prueba",
        revisado_por: admin.id,
        revisado_en: new Date().toISOString(),
      });
      expect(rechazado.error?.code).toBe(CHECK_VIOLATION);

      const subido = await subirComoAdmin(empleado, "afip estado");
      const [doc] = await altas(legajo);
      expect(doc.storage_path).toBe(subido);
      const pendiente = await service
        .from("legajo_documentos")
        .update({ estado: "pendiente", revisado_por: null, revisado_en: null })
        .eq("id", doc.id);
      expect(pendiente.error?.code).toBe(CHECK_VIOLATION);
      expect((await altas(legajo))[0].estado).toBe("aprobado");
      await service.from("legajo_documentos").delete().eq("legajo_id", legajo).eq("tipo", "alta_afip");
    });
  });
});
