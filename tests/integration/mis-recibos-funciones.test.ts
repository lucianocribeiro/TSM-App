import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearDesactivado, type ActorCapturado } from "./actores";
import { anonClient, createTestUser, deleteTestUsers, serviceClient, type TestUser, type TypedClient } from "./helpers";
import { despejarRetenidos, nuevoPeriodo, nuevoRecibo, rutaFirma, rutaRecibo } from "./recibos";

// F2-05: the recibos_firma migration. firma_registrar (versions) and
// recibo_firmar (an own pending receipt in a visible period, with the server
// time), and the Mis Recibos counter. Accounts that end up with signatures or
// evidence are kept by design (F2-02 fixtures).

const service = serviceClient();
let admin: TestUser;
let ana: TestUser;
let beto: TestUser;
let inactivo: ActorCapturado;
const cuentas: string[] = [];

beforeAll(async () => {
  admin = await createTestUser(service, "mis-fn-admin", "admin");
  ana = await createTestUser(service, "mis-fn-ana");
  beto = await createTestUser(service, "mis-fn-beto");
  inactivo = await crearDesactivado(service, admin, "mis-fn-inactivo");
  cuentas.push(admin.id, ana.id, beto.id, inactivo.id);
}, 90_000);

afterAll(async () => {
  await despejarRetenidos(service, cuentas);
  await deleteTestUsers(service, cuentas);
});

const firmas = async (id: string) =>
  (await service.from("firmas_empleado").select("version, activa, imagen_path").eq("empleado_id", id).order("version")).data ?? [];

const registrar = (c: TypedClient, path: string) => c.rpc("firma_registrar", { p_imagen_path: path });

describe("firma_registrar", () => {
  it("the first version is 1 and active; a redraw makes 2 active and keeps 1, inactive", async () => {
    const primera = rutaFirma(ana.id, 1);
    expect(await registrar(ana.client, primera)).toMatchObject({ data: 1, error: null });
    const segunda = rutaFirma(ana.id, 2);
    expect(await registrar(ana.client, segunda)).toMatchObject({ data: 2, error: null });
    expect(await firmas(ana.id)).toEqual([
      { version: 1, activa: false, imagen_path: primera },
      { version: 2, activa: true, imagen_path: segunda },
    ]);
  });

  it("refuses another employee's path (F2-03 constraint)", async () => {
    const antes = await firmas(beto.id);
    expect((await registrar(beto.client, rutaFirma(ana.id, 9))).error?.code).toBe("23514");
    expect(await firmas(beto.id)).toEqual(antes);
  });

  it("an Admin, an inactive employee and anon cannot run it", async () => {
    for (const [quien, cliente, id] of [
      ["admin", admin.client, admin.id],
      ["inactivo", inactivo.porToken, inactivo.id],
      ["anon", anonClient(), randomUUID()],
    ] as const) {
      expect((await registrar(cliente, rutaFirma(id, 1))).error?.code, quien).toBe("42501");
    }
    expect(await firmas(admin.id)).toEqual([]);
    expect(await firmas(inactivo.id)).toEqual([]);
  });
});

describe("recibo_firmar", () => {
  const firmarComo = (c: TypedClient, reciboId: string, path: string, firmadoAt = new Date()) =>
    c.rpc("recibo_firmar", { p_recibo_id: reciboId, p_archivo_path: path, p_archivo_bytes: 4096, p_firmado_at: firmadoAt.toISOString() });

  // An employee with an active signature and a pending receipt in a period of the given state.
  async function preparado(user: TestUser, estado: "publicado" | "cerrado" | "borrador" = "publicado") {
    if (!(await firmas(user.id)).some((f) => f.activa)) {
      const version = (await firmas(user.id)).length + 1;
      expect((await registrar(user.client, rutaFirma(user.id, version))).error).toBeNull();
    }
    const periodo = await nuevoPeriodo(service, admin.id, estado);
    const reciboId = await nuevoRecibo(service, periodo.id, user.id, admin.id);
    const { archivo_path } = (await service.from("recibos").select("archivo_path").eq("id", reciboId).single()).data!;
    return { periodoId: periodo.id, reciboId, anterior: archivo_path, nuevo: rutaRecibo(user.id, periodo.id) };
  }
  const recibo = async (id: string) => (await service.from("recibos").select("*").eq("id", id).single()).data!;

  it("the owner signs a pending receipt of a published and of a closed period; the evidence has the same time and signature", async () => {
    for (const estado of ["publicado", "cerrado"] as const) {
      const p = await preparado(ana, estado);
      const firmadoAt = new Date(Date.now() - 1000);
      const { data, error } = await firmarComo(ana.client, p.reciboId, p.nuevo, firmadoAt);
      expect(error, estado).toBeNull();
      expect(data, estado).toBe(p.anterior);
      const activa = (await service.from("firmas_empleado").select("id").eq("empleado_id", ana.id).eq("activa", true).single()).data!;
      const fila = await recibo(p.reciboId);
      expect(fila).toMatchObject({ estado: "firmado", archivo_path: p.nuevo, archivo_bytes: 4096, firma_id: activa.id });
      expect(new Date(fila.firmado_at!).getTime()).toBe(firmadoAt.getTime());
      const { data: evidencia } = await service.from("recibo_firmas").select("empleado_id, firma_id, firmado_at").eq("recibo_id", p.reciboId);
      expect(evidencia).toHaveLength(1);
      expect(evidencia![0]).toMatchObject({ empleado_id: ana.id, firma_id: activa.id });
      expect(new Date(evidencia![0].firmado_at).getTime()).toBe(firmadoAt.getTime());
    }
  });

  it("refuses a draft period, an already signed receipt, and no active signature", async () => {
    const borrador = await preparado(ana, "borrador");
    expect((await firmarComo(ana.client, borrador.reciboId, borrador.nuevo)).error).toMatchObject({ hint: "periodo_no_visible" });

    const p = await preparado(ana);
    expect((await firmarComo(ana.client, p.reciboId, p.nuevo)).error).toBeNull();
    expect((await firmarComo(ana.client, p.reciboId, rutaRecibo(ana.id, p.periodoId))).error).toMatchObject({
      code: "55000",
      hint: "recibo_ya_firmado",
    });

    const sinFirma = await createTestUser(service, "mis-fn-sin-firma");
    cuentas.push(sinFirma.id);
    const periodo = await nuevoPeriodo(service, admin.id, "publicado");
    const id = await nuevoRecibo(service, periodo.id, sinFirma.id, admin.id);
    expect((await firmarComo(sinFirma.client, id, rutaRecibo(sinFirma.id, periodo.id))).error).toMatchObject({ code: "55000", hint: "sin_firma" });
    expect((await recibo(id)).estado).toBe("pendiente");
  });

  it("another employee's receipt gets the same error as a missing one", async () => {
    const p = await preparado(ana);
    await preparado(beto);
    const ajeno = await firmarComo(beto.client, p.reciboId, rutaRecibo(beto.id, p.periodoId));
    const inexistente = await firmarComo(beto.client, randomUUID(), rutaRecibo(beto.id, p.periodoId));
    expect(ajeno.error).toMatchObject({ code: "P0002", hint: "recibo_ajeno" });
    expect({ code: ajeno.error?.code, hint: ajeno.error?.hint, message: ajeno.error?.message }).toEqual({
      code: inexistente.error?.code,
      hint: inexistente.error?.hint,
      message: inexistente.error?.message,
    });
    expect((await recibo(p.reciboId)).estado).toBe("pendiente");
  });

  it("refuses a time older than 2 minutes or in the future", async () => {
    const p = await preparado(ana);
    for (const firmadoAt of [new Date(Date.now() - 3 * 60_000), new Date(Date.now() + 60_000)]) {
      expect((await firmarComo(ana.client, p.reciboId, p.nuevo, firmadoAt)).error).toMatchObject({ code: "22023", hint: "hora_invalida" });
    }
    expect((await recibo(p.reciboId)).estado).toBe("pendiente");
  });

  it("refuses another employee's or period's path, and the current file itself", async () => {
    const p = await preparado(ana);
    const otroPeriodo = await nuevoPeriodo(service, admin.id, "publicado");
    for (const path of [rutaRecibo(beto.id, p.periodoId), rutaRecibo(ana.id, otroPeriodo.id)]) {
      expect((await firmarComo(ana.client, p.reciboId, path)).error?.code, path).toBe("23514");
    }
    expect((await firmarComo(ana.client, p.reciboId, p.anterior)).error).toMatchObject({ hint: "archivo_repetido" });
    expect((await recibo(p.reciboId)).estado).toBe("pendiente");
  });

  it("returns null (keep the file) when an override still holds the unsigned file", async () => {
    const p = await preparado(ana);
    const { error } = await service
      .from("recibo_overrides")
      .insert({ recibo_id: p.reciboId, motivo: "sin_dni", archivo_path: p.anterior, admin_id: admin.id });
    expect(error).toBeNull();
    expect(await firmarComo(ana.client, p.reciboId, p.nuevo)).toMatchObject({ data: null, error: null });
  });

  it("an Admin, an inactive employee and anon cannot run it", async () => {
    const p = await preparado(ana);
    for (const cliente of [admin.client, inactivo.porToken, anonClient()]) {
      expect((await firmarComo(cliente, p.reciboId, p.nuevo)).error?.code).toBe("42501");
    }
    expect((await recibo(p.reciboId)).estado).toBe("pendiente");
  });
});

describe("Mis Recibos counter (RF-23)", () => {
  it("counts only the caller's pending receipts in visible periods, and goes down after signing", async () => {
    const cuenta = await createTestUser(service, "mis-fn-contador");
    cuentas.push(cuenta.id);
    const contar = async () => (await cuenta.client.rpc("mis_recibos_pendientes_count")).data;
    expect(await contar()).toBe(0);

    const publicado = await nuevoPeriodo(service, admin.id, "publicado");
    const cerrado = await nuevoPeriodo(service, admin.id, "cerrado");
    const borrador = await nuevoPeriodo(service, admin.id, "borrador");
    const uno = await nuevoRecibo(service, publicado.id, cuenta.id, admin.id);
    await nuevoRecibo(service, cerrado.id, cuenta.id, admin.id);
    await nuevoRecibo(service, borrador.id, cuenta.id, admin.id);
    // Another employee's receipt in the same period does not count.
    await nuevoRecibo(service, publicado.id, beto.id, admin.id);
    expect(await contar()).toBe(2);

    expect((await registrar(cuenta.client, rutaFirma(cuenta.id, 1))).error).toBeNull();
    const firma = await cuenta.client.rpc("recibo_firmar", {
      p_recibo_id: uno,
      p_archivo_path: rutaRecibo(cuenta.id, publicado.id),
      p_archivo_bytes: 10,
      p_firmado_at: new Date().toISOString(),
    });
    expect(firma.error).toBeNull();
    expect(await contar()).toBe(1);
  });
});
