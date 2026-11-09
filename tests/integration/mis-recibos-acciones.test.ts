import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { copyMisRecibos } from "@/lib/copy/mis-recibos";
import { pdfConTexto } from "../pdf-minimo";
import { pngFirma } from "../png-minimo";
import { anonClient, createTestUser, deleteTestUsers, serviceClient, type TestUser } from "./helpers";
import { despejarRetenidos, FIRMAS_BUCKET, nuevoPeriodo, RECIBOS_BUCKET, rutaRecibo, subir } from "./recibos";

// F2-05: the /mis-recibos Server Actions end to end against the local stack,
// as the screen uses them: draw (a PNG) -> prepare -> upload with the token
// -> register; then sign (stamp on the server, new file, function, unsigned
// file removed), view and download. The privileged client and the PDF
// wrappers are the real ones. Invented names only.

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

const acciones = await import("@/app/(app)/mis-recibos/actions");
const { extraerTextoPdf } = await import("@/lib/recibos/pdf-texto");

const e = copyMisRecibos.errors;
const service = serviceClient();
let admin: TestUser;
let ana: TestUser;
let beto: TestUser;
const cuentas: string[] = [];

beforeAll(async () => {
  admin = await createTestUser(service, "mis-acc-admin", "admin");
  ana = await createTestUser(service, "mis-acc-ana");
  beto = await createTestUser(service, "mis-acc-beto");
  cuentas.push(admin.id, ana.id, beto.id);
  const { error } = await service.from("legajos").update({ nombres: "Ana", apellido: "Prueba Firma" }).eq("profile_id", ana.id);
  if (error) throw new Error(`legajo setup failed: ${error.message}`);
}, 60_000);

afterAll(async () => {
  session.client = null;
  await despejarRetenidos(service, cuentas);
  await deleteTestUsers(service, cuentas);
});

const como = (user: TestUser) => {
  session.client = user.client;
};

// A pending receipt with a real PDF, in a period of the given state.
async function reciboPendiente(user: TestUser, estado: "publicado" | "cerrado" = "publicado") {
  const periodo = await nuevoPeriodo(service, admin.id, estado);
  const path = rutaRecibo(user.id, periodo.id);
  await subir(service, RECIBOS_BUCKET, path, pdfConTexto(["RECIBO DE HABERES - EMPRESA DE PRUEBA", "Periodo de prueba"]), "application/pdf");
  const { data, error } = await service
    .from("recibos")
    .insert({ periodo_id: periodo.id, empleado_id: user.id, archivo_path: path, archivo_bytes: 900, cargado_por: admin.id })
    .select("id")
    .single();
  if (error || !data) throw new Error(`receipt setup failed: ${error?.message}`);
  return { id: data.id, periodoId: periodo.id, path };
}

async function existe(bucket: string, path: string): Promise<boolean> {
  return (await service.storage.from(bucket).download(path)).data !== null;
}

// Draw and register a signature as the screen does.
async function registrarFirma(user: TestUser, png = pngFirma()) {
  como(user);
  const preparada = await acciones.prepararSubidaFirma({ tamano: png.byteLength, tipo: "image/png" });
  if (!preparada.ok || !preparada.data) throw new Error(`prepare failed: ${JSON.stringify(preparada)}`);
  const { bucket, path, token } = preparada.data;
  const { error } = await anonClient().storage.from(bucket).uploadToSignedUrl(path, token, png, { contentType: "image/png" });
  if (error) throw new Error(`upload failed: ${error.message}`);
  como(user);
  return { path, result: await acciones.registrarFirma({ path }) };
}

describe("signature", () => {
  it("draw -> register: version 1, then a redraw makes version 2 and keeps 1", async () => {
    const primera = await registrarFirma(ana);
    expect(primera.result).toEqual({ ok: true, data: { version: 1 } });
    const segunda = await registrarFirma(ana);
    expect(segunda.result).toEqual({ ok: true, data: { version: 2 } });
    const { data } = await service.from("firmas_empleado").select("version, activa").eq("empleado_id", ana.id).order("version");
    expect(data).toEqual([
      { version: 1, activa: false },
      { version: 2, activa: true },
    ]);
    expect(await existe(FIRMAS_BUCKET, primera.path)).toBe(true);
    como(ana);
    const url = await acciones.obtenerUrlMiFirma({});
    expect(url.ok && url.data?.version).toBe(2);
  });

  it("an image too small or not a PNG is refused and its object removed", async () => {
    const chica = await registrarFirma(beto, pngFirma(60, 20));
    expect(chica.result).toEqual({ ok: false, error: e.firmaMedidas });
    expect(await existe(FIRMAS_BUCKET, chica.path)).toBe(false);
    const { data } = await service.from("firmas_empleado").select("id").eq("empleado_id", beto.id);
    expect(data).toEqual([]);
  });

  it("descartarSubidaFirma removes only an unreferenced object of the caller", async () => {
    como(ana);
    const preparada = await acciones.prepararSubidaFirma({ tamano: 100, tipo: "image/png" });
    const path = preparada.ok ? preparada.data!.path : "";
    await subir(service, FIRMAS_BUCKET, path, pngFirma(), "image/png");
    como(ana);
    expect(await acciones.descartarSubidaFirma({ path })).toEqual({ ok: true });
    expect(await existe(FIRMAS_BUCKET, path)).toBe(false);

    const { data: activa } = await service.from("firmas_empleado").select("imagen_path").eq("empleado_id", ana.id).eq("activa", true).single();
    expect(await acciones.descartarSubidaFirma({ path: activa!.imagen_path })).toEqual({ ok: false, error: e.accionFallo });
    expect(await existe(FIRMAS_BUCKET, activa!.imagen_path)).toBe(true);
  });
});

describe("signing", () => {
  it("signs: the current file is the stamped PDF at a new path, the unsigned object is gone, the counter goes down", async () => {
    const r = await reciboPendiente(ana);
    como(ana);
    const antes = (await ana.client.rpc("mis_recibos_pendientes_count")).data!;
    const result = await acciones.firmarRecibo({ reciboId: r.id });
    expect(result).toMatchObject({ ok: true, data: { estado: "firmado", firmadoAt: expect.any(String) } });
    const firmadoAt = result.ok && result.data?.estado === "firmado" ? result.data.firmadoAt : "";

    const { data: fila } = await service.from("recibos").select("archivo_path, estado, firmado_at").eq("id", r.id).single();
    expect(fila!.estado).toBe("firmado");
    expect(fila!.archivo_path).not.toBe(r.path);
    expect(new Date(fila!.firmado_at!).getTime()).toBe(new Date(firmadoAt).getTime());
    expect(await existe(RECIBOS_BUCKET, r.path)).toBe(false);

    // The stamp line on the last page, read back through the wrapper.
    const { data: firmado } = await service.storage.from(RECIBOS_BUCKET).download(fila!.archivo_path);
    const texto = await extraerTextoPdf(new Uint8Array(await firmado!.arrayBuffer()));
    expect(texto.ok && texto.paginas.at(-1)).toContain("Firmado electrónicamente por Ana Prueba Firma el ");
    expect(texto.ok && texto.paginas.at(-1)).toContain("(hora de Argentina)");

    expect((await ana.client.rpc("mis_recibos_pendientes_count")).data).toBe(antes - 1);
  });

  it("storage after signing: the employee reads the signed file and not the old path; the Admin reads the signed file", async () => {
    const r = await reciboPendiente(ana);
    como(ana);
    expect((await acciones.firmarRecibo({ reciboId: r.id })).ok).toBe(true);
    const { data: fila } = await service.from("recibos").select("archivo_path").eq("id", r.id).single();
    expect((await ana.client.storage.from(RECIBOS_BUCKET).download(fila!.archivo_path)).data).not.toBeNull();
    expect((await ana.client.storage.from(RECIBOS_BUCKET).download(r.path)).data).toBeNull();
    expect((await admin.client.storage.from(RECIBOS_BUCKET).download(fila!.archivo_path)).data).not.toBeNull();
  });

  it("a double sign: one signs, the other is refused, and only one signed file stays", async () => {
    const r = await reciboPendiente(ana, "cerrado");
    como(ana);
    const resultados = await Promise.all([acciones.firmarRecibo({ reciboId: r.id }), acciones.firmarRecibo({ reciboId: r.id })]);
    expect(resultados.filter((x) => x.ok)).toHaveLength(1);
    expect(resultados.filter((x) => !x.ok)).toEqual([{ ok: false, error: e.yaFirmado }]);
    const { data: objetos } = await service.storage.from(RECIBOS_BUCKET).list(`${ana.id}/${r.periodoId}`);
    expect((objetos ?? []).map((o) => o.name)).toHaveLength(1);
    const { data: evidencia } = await service.from("recibo_firmas").select("id").eq("recibo_id", r.id);
    expect(evidencia).toHaveLength(1);
  });

  it("without a signature the screen is asked for the drawing first; nothing is stored", async () => {
    const sinFirma = await createTestUser(service, "mis-acc-sin-firma");
    cuentas.push(sinFirma.id);
    const r = await reciboPendiente(sinFirma);
    como(sinFirma);
    expect(await acciones.firmarRecibo({ reciboId: r.id })).toEqual({ ok: true, data: { estado: "sin_firma" } });
    const { data: objetos } = await service.storage.from(RECIBOS_BUCKET).list(`${sinFirma.id}/${r.periodoId}`);
    expect((objetos ?? []).map((o) => o.name)).toEqual([r.path.split("/").at(-1)]);
  });
});

describe("links", () => {
  it("ver works before signing, descargar only after, named Recibo-MM-AAAA.pdf", async () => {
    const r = await reciboPendiente(ana);
    como(ana);
    const ver = await acciones.obtenerUrlRecibo({ reciboId: r.id, modo: "ver" });
    expect(ver.ok && ver.data?.url).toContain(`/object/sign/${RECIBOS_BUCKET}/`);
    expect(ver.ok && ver.data?.url).not.toContain("download=");
    expect(await acciones.obtenerUrlRecibo({ reciboId: r.id, modo: "descargar" })).toEqual({ ok: false, error: e.descargaNoDisponible });

    expect((await acciones.firmarRecibo({ reciboId: r.id })).ok).toBe(true);
    const { data: periodo } = await service.from("recibo_periodos").select("anio, mes").eq("id", r.periodoId).single();
    const descarga = await acciones.obtenerUrlRecibo({ reciboId: r.id, modo: "descargar" });
    const nombre = `Recibo-${String(periodo!.mes).padStart(2, "0")}-${periodo!.anio}.pdf`;
    expect(descarga.ok && decodeURIComponent(descarga.data!.url)).toContain(`download=${nombre}`);
  });

  it("another employee's receipt is not found, for viewing and for signing", async () => {
    const r = await reciboPendiente(ana);
    como(beto);
    expect(await acciones.obtenerUrlRecibo({ reciboId: r.id, modo: "ver" })).toEqual({ ok: false, error: e.noEncontrado });
    expect(await acciones.firmarRecibo({ reciboId: r.id })).toEqual({ ok: false, error: e.noEncontrado });
  });

  it("an Admin is refused before anything happens", async () => {
    const r = await reciboPendiente(ana);
    como(admin);
    expect(await acciones.firmarRecibo({ reciboId: r.id })).toEqual({ ok: false, error: copy.cuentas.errors.noAutorizado });
    expect(await acciones.obtenerUrlRecibo({ reciboId: r.id, modo: "ver" })).toEqual({ ok: false, error: copy.cuentas.errors.noAutorizado });
    const { data } = await service.from("recibos").select("estado").eq("id", r.id).single();
    expect(data).toEqual({ estado: "pendiente" });
  });
});
