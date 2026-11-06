import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearDesactivado, fakePdf, type ActorCapturado } from "./actores";
import { anonClient, createTestUser, deleteTestUsers, serviceClient, type TestUser, type TypedClient } from "./helpers";
import {
  borrarObjetosRecibos,
  borrarReciboYPeriodo,
  despejarRetenidos,
  fakePng,
  FIRMAS_BUCKET,
  nuevaFirma,
  nuevaFirmaConImagen,
  nuevoPeriodo,
  nuevoRecibo,
  nuevoReciboConArchivo,
  ponerEstadoPeriodo,
  RECIBOS_BUCKET,
  rutaFirma,
  rutaRecibo,
  subir,
} from "./recibos";

// F2-03, receipts and signatures storage (PRD Fase 2 v0.5 §6, Constitution
// §11). The access matrix (matriz-acceso.ts) runs both buckets for every
// actor and operation: no API role writes them, anon reads nothing, an
// inactive account reads nothing. This file covers what depends on state:
// the bucket limits, which files an Empleado reads (published and closed
// periods only, own files only, never a replaced or unreferenced one), the
// signature images, and the path ownership constraints.
//
// Accounts with history or signature rows stay by design (./recibos.ts).

const ERROR_CHECK = "23514";

async function lee(cliente: TypedClient, bucket: string, path: string): Promise<boolean> {
  const { data } = await cliente.storage.from(bucket).download(path);
  return data !== null;
}

describe("receipts and signatures storage (F2-03)", () => {
  const service = serviceClient();
  let admin: TestUser;
  let empleado: TestUser;
  let otro: TestUser;
  let inactivo: ActorCapturado;
  let adminInactivo: ActorCapturado;
  const usuarios: string[] = [];
  const limpieza: { recibo: string | null; periodo: string }[] = [];

  async function periodo(estado: "borrador" | "publicado" | "cerrado") {
    const p = await nuevoPeriodo(service, admin.id, estado);
    limpieza.push({ recibo: null, periodo: p.id });
    return p.id;
  }

  async function reciboConArchivo(periodoId: string, user: { id: string }) {
    const r = await nuevoReciboConArchivo(service, periodoId, user.id, admin.id);
    limpieza.unshift({ recibo: r.id, periodo: periodoId });
    return r.path;
  }

  beforeAll(async () => {
    admin = await createTestUser(service, "storage-admin", "admin");
    empleado = await createTestUser(service, "storage-empleado");
    otro = await createTestUser(service, "storage-otro");
    inactivo = await crearDesactivado(service, admin, "storage-inactivo");
    adminInactivo = await crearDesactivado(service, admin, "storage-admin-inactivo", "admin");
    usuarios.push(empleado.id, otro.id, inactivo.id, adminInactivo.id, admin.id);
  }, 120_000);

  afterAll(async () => {
    try {
      for (const { recibo: id, periodo: p } of limpieza) await borrarReciboYPeriodo(service, id, p);
      await borrarObjetosRecibos(service, usuarios);
      await despejarRetenidos(service, usuarios);
    } finally {
      await deleteTestUsers(service, usuarios);
    }
  });

  describe("buckets", () => {
    it("are private, with their size and MIME limits", async () => {
      const { data, error } = await service.storage.listBuckets();
      expect(error).toBeNull();
      const porId = new Map((data ?? []).map((b) => [b.id, b]));
      expect(porId.get(RECIBOS_BUCKET)).toMatchObject({
        public: false,
        file_size_limit: 10 * 1024 * 1024,
        allowed_mime_types: ["application/pdf"],
      });
      expect(porId.get(FIRMAS_BUCKET)).toMatchObject({
        public: false,
        file_size_limit: 1024 * 1024,
        allowed_mime_types: ["image/png"],
      });
    });

    // A signed upload URL created by the server; the upload itself runs as
    // anon, as the browser will.
    async function subirFirmado(bucket: string, path: string, cuerpo: Buffer, contentType: string) {
      const url = await service.storage.from(bucket).createSignedUploadUrl(path);
      expect(url.error).toBeNull();
      return anonClient().storage.from(bucket).uploadToSignedUrl(path, url.data!.token, cuerpo, { contentType });
    }

    it("a signed upload URL takes a PDF into recibos and a PNG into firmas", async () => {
      const recibo = rutaRecibo(empleado.id, randomUUID());
      const firma = rutaFirma(empleado.id, 1);
      expect((await subirFirmado(RECIBOS_BUCKET, recibo, fakePdf("subida"), "application/pdf")).error).toBeNull();
      expect((await subirFirmado(FIRMAS_BUCKET, firma, fakePng("subida"), "image/png")).error).toBeNull();
      expect(await lee(service, RECIBOS_BUCKET, recibo)).toBe(true);
      expect(await lee(service, FIRMAS_BUCKET, firma)).toBe(true);
    });

    it("refuses another type and a file over the limit, through a signed upload URL", async () => {
      const intentos = [
        [RECIBOS_BUCKET, rutaRecibo(empleado.id, randomUUID()), fakePng("no pdf"), "image/png"],
        [RECIBOS_BUCKET, rutaRecibo(empleado.id, randomUUID()), Buffer.from("texto"), "text/plain"],
        [RECIBOS_BUCKET, rutaRecibo(empleado.id, randomUUID()), Buffer.alloc(10 * 1024 * 1024 + 1, 0x25), "application/pdf"],
        [FIRMAS_BUCKET, rutaFirma(empleado.id, 2), fakePdf("no png"), "application/pdf"],
        [FIRMAS_BUCKET, rutaFirma(empleado.id, 3), Buffer.from("jpg"), "image/jpeg"],
        [FIRMAS_BUCKET, rutaFirma(empleado.id, 4), Buffer.alloc(1024 * 1024 + 1, 0x89), "image/png"],
      ] as const;
      for (const [bucket, path, cuerpo, contentType] of intentos) {
        const { error } = await subirFirmado(bucket, path, cuerpo, contentType);
        expect(error, `${bucket} ${contentType} ${cuerpo.length}`).not.toBeNull();
        expect(await lee(service, bucket, path), path).toBe(false);
      }
    });
  });

  describe("recibos: which files an Empleado reads", () => {
    it("own files of published and closed periods only; never a draft's, another employee's, a replaced or an unreferenced one", async () => {
      const publicado = await periodo("publicado");
      const cerrado = await periodo("cerrado");
      const borrador = await periodo("borrador");
      const propioPublicado = await reciboConArchivo(publicado, empleado);
      const propioCerrado = await reciboConArchivo(cerrado, empleado);
      const propioBorrador = await reciboConArchivo(borrador, empleado);
      const ajeno = await reciboConArchivo(publicado, otro);

      // A replaced file: referenced only by the Admin-only history (the row
      // is append-only, so this employee's account stays).
      const reemplazado = rutaRecibo(empleado.id, publicado);
      await subir(service, RECIBOS_BUCKET, reemplazado, fakePdf("reemplazado"), "application/pdf");
      const actual = await service.from("recibos").select("id").eq("archivo_path", propioPublicado).single();
      const historial = await service.from("recibo_historial").insert({
        recibo_id: actual.data!.id,
        periodo_id: publicado,
        empleado_id: empleado.id,
        archivo_path: reemplazado,
        archivo_bytes: 10,
        estado_al_reemplazo: "pendiente",
        cargado_por: admin.id,
        cargado_at: new Date().toISOString(),
        reemplazado_por: admin.id,
      });
      expect(historial.error).toBeNull();

      // An object in the employee's own folder that no row references.
      const suelto = rutaRecibo(empleado.id, publicado);
      await subir(service, RECIBOS_BUCKET, suelto, fakePdf("suelto"), "application/pdf");

      const lecturas = async (cliente: TypedClient) => ({
        propioPublicado: await lee(cliente, RECIBOS_BUCKET, propioPublicado),
        propioCerrado: await lee(cliente, RECIBOS_BUCKET, propioCerrado),
        propioBorrador: await lee(cliente, RECIBOS_BUCKET, propioBorrador),
        ajeno: await lee(cliente, RECIBOS_BUCKET, ajeno),
        reemplazado: await lee(cliente, RECIBOS_BUCKET, reemplazado),
        suelto: await lee(cliente, RECIBOS_BUCKET, suelto),
      });

      expect(await lecturas(empleado.client)).toEqual({
        propioPublicado: true,
        propioCerrado: true,
        propioBorrador: false,
        ajeno: false,
        reemplazado: false,
        suelto: false,
      });
      expect(await lecturas(admin.client)).toEqual({
        propioPublicado: true,
        propioCerrado: true,
        propioBorrador: true,
        ajeno: true,
        reemplazado: true,
        suelto: true,
      });

      // A signed URL is only issued for what the caller can read.
      expect((await empleado.client.storage.from(RECIBOS_BUCKET).createSignedUrl(propioPublicado, 300)).data?.signedUrl).toBeTruthy();
      for (const path of [propioBorrador, ajeno, reemplazado, suelto]) {
        expect((await empleado.client.storage.from(RECIBOS_BUCKET).createSignedUrl(path, 300)).data, path).toBeNull();
      }
      // Listing shows the employee none of the unreachable files.
      const { data: listado } = await empleado.client.storage.from(RECIBOS_BUCKET).list(`${empleado.id}/${publicado}`);
      expect((listado ?? []).map((o) => `${empleado.id}/${publicado}/${o.name}`)).toEqual([propioPublicado]);
    });

    it("a file moves out of reach when its period goes back to draft", async () => {
      const p = await periodo("publicado");
      const path = await reciboConArchivo(p, empleado);
      expect(await lee(empleado.client, RECIBOS_BUCKET, path)).toBe(true);
      await ponerEstadoPeriodo(service, p, "borrador", admin.id);
      expect(await lee(empleado.client, RECIBOS_BUCKET, path)).toBe(false);
    });
  });

  describe("firmas: signature images", () => {
    it("an Empleado reads their own active and old images, never another employee's; the Admin reads all", async () => {
      const vieja = await nuevaFirmaConImagen(service, empleado.id);
      const activa = await nuevaFirmaConImagen(service, empleado.id);
      const ajena = await nuevaFirmaConImagen(service, otro.id);
      const suelta = rutaFirma(empleado.id, 900);
      await subir(service, FIRMAS_BUCKET, suelta, fakePng("suelta"), "image/png");
      const { data: filas } = await service.from("firmas_empleado").select("id, activa").in("id", [vieja.id, activa.id]);
      expect(new Map((filas ?? []).map((f) => [f.id, f.activa]))).toEqual(new Map([[vieja.id, false], [activa.id, true]]));

      const lecturas = async (cliente: TypedClient) =>
        Promise.all([vieja.path, activa.path, ajena.path, suelta].map((path) => lee(cliente, FIRMAS_BUCKET, path)));
      expect(await lecturas(empleado.client)).toEqual([true, true, false, false]);
      expect(await lecturas(otro.client)).toEqual([false, false, true, false]);
      expect(await lecturas(admin.client)).toEqual([true, true, true, true]);
    });
  });

  describe("no direct writes, and no access when inactive", () => {
    it("neither the Admin nor an Empleado moves or copies an object, and anon cannot list either bucket", async () => {
      const p = await periodo("publicado");
      const path = await reciboConArchivo(p, empleado);
      const firma = await nuevaFirmaConImagen(service, empleado.id);
      for (const user of [admin, empleado]) {
        const recibos = user.client.storage.from(RECIBOS_BUCKET);
        const firmas = user.client.storage.from(FIRMAS_BUCKET);
        expect((await recibos.move(path, rutaRecibo(empleado.id, p))).error, user.email).not.toBeNull();
        expect((await recibos.copy(path, rutaRecibo(empleado.id, p))).error, user.email).not.toBeNull();
        expect((await firmas.move(firma.path, rutaFirma(empleado.id, 901))).error, user.email).not.toBeNull();
        expect((await firmas.copy(firma.path, rutaFirma(empleado.id, 902))).error, user.email).not.toBeNull();
      }
      expect(await lee(service, RECIBOS_BUCKET, path)).toBe(true);
      expect(await lee(service, FIRMAS_BUCKET, firma.path)).toBe(true);
      const { data: copias } = await service.storage.from(RECIBOS_BUCKET).list(`${empleado.id}/${p}`);
      expect(copias?.length).toBe(1);

      const anon = anonClient();
      for (const bucket of [RECIBOS_BUCKET, FIRMAS_BUCKET]) {
        const { data } = await anon.storage.from(bucket).list(empleado.id);
        expect(data ?? [], bucket).toEqual([]);
      }
      expect(await lee(anon, RECIBOS_BUCKET, path)).toBe(false);
      expect(await lee(anon, FIRMAS_BUCKET, firma.path)).toBe(false);
    });

    it("a deactivated Empleado and a deactivated Admin read no object, their own included", async () => {
      const p = await periodo("publicado");
      const propio = await reciboConArchivo(p, inactivo);
      const ajeno = await reciboConArchivo(p, empleado);
      const firmaPropia = await nuevaFirmaConImagen(service, inactivo.id);
      const firmaAjena = await nuevaFirmaConImagen(service, otro.id);
      for (const actor of [inactivo, adminInactivo]) {
        for (const [bucket, path] of [
          [RECIBOS_BUCKET, propio],
          [RECIBOS_BUCKET, ajeno],
          [FIRMAS_BUCKET, firmaPropia.path],
          [FIRMAS_BUCKET, firmaAjena.path],
        ] as const) {
          expect(await lee(actor.porToken, bucket, path), `${actor.email} ${path}`).toBe(false);
        }
        expect((await actor.porToken.storage.from(RECIBOS_BUCKET).list(inactivo.id)).data ?? []).toEqual([]);
      }
    });
  });

  describe("path ownership constraints", () => {
    it("a receipt, its history and its override live in the folder of the receipt's owner and period", async () => {
      const p = await periodo("borrador");
      const q = await periodo("borrador");
      const base = { periodo_id: p, empleado_id: empleado.id, archivo_bytes: 1, cargado_por: admin.id };
      for (const archivo_path of [
        rutaRecibo(otro.id, p),
        rutaRecibo(empleado.id, q),
        `${empleado.id}/${p}/${randomUUID()}.png`,
        `${p}/${empleado.id}/${randomUUID()}.pdf`,
        `x/${empleado.id}/${p}/${randomUUID()}.pdf`,
      ]) {
        expect((await service.from("recibos").insert({ ...base, archivo_path })).error?.code, archivo_path).toBe(ERROR_CHECK);
      }

      const r = await nuevoRecibo(service, p, empleado.id, admin.id);
      limpieza.unshift({ recibo: r, periodo: p });
      const historial = {
        recibo_id: r,
        periodo_id: p,
        empleado_id: empleado.id,
        archivo_bytes: 1,
        estado_al_reemplazo: "pendiente" as const,
        cargado_por: admin.id,
        cargado_at: new Date().toISOString(),
        reemplazado_por: admin.id,
      };
      for (const archivo_path of [rutaRecibo(otro.id, p), rutaRecibo(empleado.id, q), `${empleado.id}/${p}/x.png`]) {
        expect((await service.from("recibo_historial").insert({ ...historial, archivo_path })).error?.code, archivo_path).toBe(ERROR_CHECK);
      }
      for (const archivo_path of [rutaRecibo(otro.id, p), rutaRecibo(empleado.id, q), `${empleado.id}/${p}/x.png`]) {
        const { error } = await service.from("recibo_overrides").insert({ recibo_id: r, motivo: "sin_dni", archivo_path, admin_id: admin.id });
        expect(error?.code, archivo_path).toBe(ERROR_CHECK);
        expect(error?.hint, archivo_path).toBe("ruta_recibo_ajena");
      }
      expect((await service.from("recibo_historial").select("id").eq("recibo_id", r)).data).toEqual([]);
      expect((await service.from("recibo_overrides").select("id").eq("recibo_id", r)).data).toEqual([]);
    });

    it("a registered signature lives in its owner's folder, as a PNG", async () => {
      await nuevaFirma(service, otro.id);
      const { data: ultima } = await service
        .from("firmas_empleado")
        .select("version")
        .eq("empleado_id", otro.id)
        .order("version", { ascending: false })
        .limit(1)
        .single();
      const version = (ultima?.version ?? 0) + 1;
      for (const imagen_path of [rutaFirma(empleado.id, version), `${otro.id}/${version}-${randomUUID()}.jpg`, `firmas/${otro.id}/${version}.png`]) {
        const { error } = await service.from("firmas_empleado").insert({ empleado_id: otro.id, version, imagen_path, activa: false });
        expect(error?.code, imagen_path).toBe(ERROR_CHECK);
      }
      expect((await service.from("firmas_empleado").select("id").eq("empleado_id", otro.id).eq("version", version)).data).toEqual([]);
    });
  });
});
