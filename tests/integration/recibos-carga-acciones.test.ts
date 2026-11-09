import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { copyRecibos } from "@/lib/copy/recibos";
import { pdfConTexto } from "../pdf-minimo";
import { anonClient, createTestUser, deleteTestUsers, serviceClient, type TestUser } from "./helpers";
import { despejarRetenidos, nuevoPeriodo, ponerEstadoPeriodo, RECIBOS_BUCKET } from "./recibos";

// F2-04: the /recibos Server Actions end to end against the local stack, as
// the screen uses them: prepare (signed upload URL), upload with the token
// (no session, as the browser does), register with the real DNI check on the
// stored bytes, confirm or discard. The privileged client is the real one.
// Invented names and DNIs only.

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

const acciones = await import("@/app/(app)/recibos/actions");

const e = copyRecibos.errors;
const service = serviceClient();
const DNI = "30111222";
let admin: TestUser;
let empleado: TestUser;
const cuentas: string[] = [];

beforeAll(async () => {
  admin = await createTestUser(service, "carga-acc-admin", "admin");
  empleado = await createTestUser(service, "carga-acc-empleado");
  cuentas.push(admin.id, empleado.id);
  const { error } = await service.from("legajos").update({ dni: DNI, nombres: "Prueba", apellido: "Inventada" }).eq("profile_id", empleado.id);
  if (error) throw new Error(`legajo setup failed: ${error.message}`);
}, 60_000);

afterAll(async () => {
  session.client = null;
  await despejarRetenidos(service, cuentas);
  await deleteTestUsers(service, cuentas);
});

const reciboCon = (dni: string) => pdfConTexto(["RECIBO DE HABERES - EMPRESA DE PRUEBA", "Empleado: Prueba Inventada", `DNI ${dni}`]);

async function existe(path: string): Promise<boolean> {
  const { data } = await service.storage.from(RECIBOS_BUCKET).download(path);
  return data !== null;
}

// Prepare and upload as the browser does; returns the path.
async function subir(periodoId: string, cuerpo: Buffer, empleadoId = empleado.id): Promise<string> {
  session.client = admin.client;
  const preparada = await acciones.prepararSubidaRecibo({ periodoId, empleadoId, tamano: cuerpo.byteLength, tipo: "application/pdf" });
  if (!preparada.ok || !preparada.data) throw new Error(`prepare failed: ${JSON.stringify(preparada)}`);
  const { bucket, path, token } = preparada.data;
  const { error } = await anonClient().storage.from(bucket).uploadToSignedUrl(path, token, cuerpo, { contentType: "application/pdf" });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return path;
}

const registrar = (periodoId: string, path: string, extra: Record<string, unknown> = {}) => {
  session.client = admin.client;
  return acciones.registrarRecibo({ periodoId, empleadoId: empleado.id, path, ...extra });
};

async function filaDe(periodoId: string) {
  return (await service.from("recibos").select("id, archivo_path, estado").eq("periodo_id", periodoId).eq("empleado_id", empleado.id).maybeSingle()).data;
}
const overridesDe = async (reciboId: string) =>
  (await service.from("recibo_overrides").select("motivo, archivo_path, admin_id").eq("recibo_id", reciboId)).data ?? [];

describe("registrarRecibo", () => {
  it("registers a file with the employee's DNI, with no override", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    const path = await subir(p.id, reciboCon("30.111.222"));
    const result = await registrar(p.id, path);
    expect(result).toEqual({ ok: true, data: { estado: "registrado", reciboId: expect.any(String) } });
    const fila = await filaDe(p.id);
    expect(fila).toMatchObject({ archivo_path: path, estado: "pendiente" });
    expect(await overridesDe(fila!.id)).toEqual([]);
    expect(await existe(path)).toBe(true);
  });

  it("a mismatch asks first and keeps the file; the right confirmation records the override", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    const path = await subir(p.id, reciboCon("99888777"));
    expect(await registrar(p.id, path)).toEqual({ ok: true, data: { estado: "confirmar_dni", motivo: "dni_no_encontrado" } });
    expect(await existe(path)).toBe(true);
    expect(await filaDe(p.id)).toBeNull();

    const result = await registrar(p.id, path, { confirmarDni: "dni_no_encontrado" });
    expect(result).toEqual({ ok: true, data: { estado: "registrado", reciboId: expect.any(String) } });
    const fila = await filaDe(p.id);
    expect(await overridesDe(fila!.id)).toEqual([{ motivo: "dni_no_encontrado", archivo_path: path, admin_id: admin.id }]);
  });

  it("a confirmation with another motivo is refused and the file removed (decision 7)", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    const path = await subir(p.id, reciboCon("99888777"));
    expect(await registrar(p.id, path, { confirmarDni: "sin_dni" })).toEqual({ ok: false, error: e.dniCambio });
    expect(await existe(path)).toBe(false);
    expect(await filaDe(p.id)).toBeNull();
  });

  it("a file with no text is not verifiable, with its reason", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    const path = await subir(p.id, pdfConTexto([]));
    expect(await registrar(p.id, path)).toEqual({
      ok: true,
      data: { estado: "confirmar_dni", motivo: "no_verificable", detalle: "sin_texto" },
    });
  });

  it("non-PDF bytes behind a .pdf path: the object is removed and the file error returned", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    const path = await subir(p.id, Buffer.from("esto no es un PDF de prueba"));
    expect(await registrar(p.id, path)).toEqual({ ok: false, error: e.contenido });
    expect(await existe(path)).toBe(false);
  });

  it("a function failure (the period closed meanwhile) removes the object", async () => {
    const p = await nuevoPeriodo(service, admin.id, "publicado");
    const path = await subir(p.id, reciboCon(DNI));
    await ponerEstadoPeriodo(service, p.id, "cerrado", admin.id);
    expect(await registrar(p.id, path)).toEqual({ ok: false, error: e.periodoCerrado });
    expect(await existe(path)).toBe(false);
    expect(await filaDe(p.id)).toBeNull();
  });

  it("a second file asks for the replacement; confirmed, the old file stays in storage and in the history", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    const primero = await subir(p.id, reciboCon(DNI));
    expect((await registrar(p.id, primero)).ok).toBe(true);

    const segundo = await subir(p.id, reciboCon(DNI));
    expect(await registrar(p.id, segundo)).toEqual({ ok: true, data: { estado: "confirmar_reemplazo", firmado: false } });
    expect(await registrar(p.id, segundo, { confirmarReemplazo: true })).toEqual({
      ok: true,
      data: { estado: "registrado", reciboId: expect.any(String) },
    });
    const fila = await filaDe(p.id);
    expect(fila).toMatchObject({ archivo_path: segundo, estado: "pendiente" });
    const { data: historial } = await service.from("recibo_historial").select("archivo_path").eq("recibo_id", fila!.id);
    expect(historial).toEqual([{ archivo_path: primero }]);
    expect(await existe(primero)).toBe(true);
    expect(await existe(segundo)).toBe(true);
  });

  it("the DNI question comes before the replacement question", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    expect((await registrar(p.id, await subir(p.id, reciboCon(DNI)))).ok).toBe(true);
    const path = await subir(p.id, reciboCon("99888777"));
    expect(await registrar(p.id, path)).toEqual({ ok: true, data: { estado: "confirmar_dni", motivo: "dni_no_encontrado" } });
    expect(await registrar(p.id, path, { confirmarDni: "dni_no_encontrado" })).toEqual({
      ok: true,
      data: { estado: "confirmar_reemplazo", firmado: false },
    });
    expect((await registrar(p.id, path, { confirmarDni: "dni_no_encontrado", confirmarReemplazo: true })).ok).toBe(true);
  });

  it("an Empleado is refused before anything happens", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    const path = await subir(p.id, reciboCon(DNI));
    session.client = empleado.client;
    expect(await acciones.registrarRecibo({ periodoId: p.id, empleadoId: empleado.id, path })).toEqual({
      ok: false,
      error: copy.cuentas.errors.noAutorizado,
    });
    expect(await existe(path)).toBe(true);
    expect(await filaDe(p.id)).toBeNull();
  });
});

describe("descartarSubidaRecibo", () => {
  it("removes an unreferenced upload (Rechazar), and never a file a receipt holds", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    const suelto = await subir(p.id, reciboCon("99888777"));
    session.client = admin.client;
    expect(await acciones.descartarSubidaRecibo({ periodoId: p.id, empleadoId: empleado.id, path: suelto })).toEqual({ ok: true });
    expect(await existe(suelto)).toBe(false);

    const vigente = await subir(p.id, reciboCon(DNI));
    expect((await registrar(p.id, vigente)).ok).toBe(true);
    session.client = admin.client;
    expect(await acciones.descartarSubidaRecibo({ periodoId: p.id, empleadoId: empleado.id, path: vigente })).toEqual({
      ok: false,
      error: e.accionFallo,
    });
    expect(await existe(vigente)).toBe(true);
  });
});

describe("prepararSubidaRecibo and obtenerUrlReciboAdmin", () => {
  it("refuses a closed period and a non-eligible account, and gives the Admin a link to the current file", async () => {
    const cerrado = await nuevoPeriodo(service, admin.id, "cerrado");
    session.client = admin.client;
    expect(await acciones.prepararSubidaRecibo({ periodoId: cerrado.id, empleadoId: empleado.id, tamano: 100, tipo: "application/pdf" })).toEqual({
      ok: false,
      error: e.periodoCerrado,
    });
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    expect(await acciones.prepararSubidaRecibo({ periodoId: p.id, empleadoId: admin.id, tamano: 100, tipo: "application/pdf" })).toEqual({
      ok: false,
      error: e.empleadoNoElegible,
    });

    const path = await subir(p.id, reciboCon(DNI));
    const registrado = await registrar(p.id, path);
    const reciboId = registrado.ok && registrado.data?.estado === "registrado" ? registrado.data.reciboId : "";
    session.client = admin.client;
    const url = await acciones.obtenerUrlReciboAdmin({ reciboId });
    expect(url.ok && url.data?.url).toContain(`/object/sign/${RECIBOS_BUCKET}/`);
  });
});
