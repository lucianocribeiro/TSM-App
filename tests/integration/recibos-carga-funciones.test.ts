import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearDesactivado, type ActorCapturado } from "./actores";
import { anonClient, createTestUser, deleteTestUsers, serviceClient, type TestUser, type TypedClient } from "./helpers";
import { despejarRetenidos, firmarRecibo, nuevaFirma, nuevoPeriodo, nuevoRecibo, rutaRecibo } from "./recibos";

// F2-04: the recibos_carga migration. The period functions (create, publish,
// close, re-open), recibo_registrar (new, replacement, override), the signed
// receipt guard's replacement rule and the path indexes. Accounts that end up
// with history, overrides or signatures are kept by design (F2-02 fixtures).

const service = serviceClient();
let admin: TestUser;
let empleado: TestUser;
let otro: TestUser;
let adminInactivo: ActorCapturado;
let empleadoInactivo: ActorCapturado;
const cuentas: string[] = [];

beforeAll(async () => {
  admin = await createTestUser(service, "carga-fn-admin", "admin");
  empleado = await createTestUser(service, "carga-fn-empleado");
  otro = await createTestUser(service, "carga-fn-otro");
  adminInactivo = await crearDesactivado(service, admin, "carga-fn-admin-inactivo", "admin");
  empleadoInactivo = await crearDesactivado(service, admin, "carga-fn-empleado-inactivo");
  cuentas.push(admin.id, empleado.id, otro.id, adminInactivo.id, empleadoInactivo.id);
}, 90_000);

afterAll(async () => {
  await despejarRetenidos(service, cuentas);
  await deleteTestUsers(service, cuentas);
});

// A month no other test uses, created by the Admin through the function.
async function periodoNuevo(): Promise<string> {
  for (let intento = 0; intento < 50; intento++) {
    const { data, error } = await admin.client.rpc("recibo_periodo_crear", { p_anio: randomInt(2000, 2101), p_mes: randomInt(1, 13) });
    if (data) return data;
    if (error?.hint !== "periodo_existente") throw new Error(`period create failed: ${error?.message}`);
  }
  throw new Error("no free month");
}

async function periodo(id: string) {
  return (await service.from("recibo_periodos").select("*").eq("id", id).single()).data!;
}
async function historialPeriodo(id: string) {
  return (await service.from("recibo_periodo_historial").select("accion, actor_id").eq("periodo_id", id).order("created_at")).data ?? [];
}
const transiciones = {
  publicar: (c: TypedClient, id: string) => c.rpc("recibo_periodo_publicar", { p_periodo_id: id }),
  cerrar: (c: TypedClient, id: string) => c.rpc("recibo_periodo_cerrar", { p_periodo_id: id }),
  reabrir: (c: TypedClient, id: string) => c.rpc("recibo_periodo_reabrir", { p_periodo_id: id }),
};

describe("period functions", () => {
  it("an Admin creates a draft period and the creation is logged with the actor", async () => {
    const id = await periodoNuevo();
    expect(await periodo(id)).toMatchObject({ estado: "borrador", created_by: admin.id, publicado_at: null, cerrado_at: null });
    expect(await historialPeriodo(id)).toEqual([{ accion: "creado", actor_id: admin.id }]);
  });

  it("refuses a month that already has a period, and a month or year out of range", async () => {
    const id = await periodoNuevo();
    const { anio, mes } = await periodo(id);
    const duplicado = await admin.client.rpc("recibo_periodo_crear", { p_anio: anio, p_mes: mes });
    expect(duplicado.error).toMatchObject({ code: "23505", hint: "periodo_existente" });
    for (const [a, m] of [[1999, 1], [2101, 1], [2026, 0], [2026, 13]]) {
      const fuera = await admin.client.rpc("recibo_periodo_crear", { p_anio: a, p_mes: m });
      expect(fuera.error, `${a}-${m}`).toMatchObject({ code: "22023", hint: "periodo_invalido" });
    }
  });

  it("publish, close and re-open, each only from its state, each logged; anything else is transicion_invalida", async () => {
    const id = await periodoNuevo();
    const invalida = { code: "55000", hint: "transicion_invalida" };

    expect((await transiciones.cerrar(admin.client, id)).error).toMatchObject(invalida);
    expect((await transiciones.reabrir(admin.client, id)).error).toMatchObject(invalida);

    expect((await transiciones.publicar(admin.client, id)).error).toBeNull();
    const publicado = await periodo(id);
    expect(publicado).toMatchObject({ estado: "publicado", publicado_por: admin.id, cerrado_at: null });
    expect(publicado.publicado_at).not.toBeNull();
    expect((await transiciones.publicar(admin.client, id)).error).toMatchObject(invalida);
    expect((await transiciones.reabrir(admin.client, id)).error).toMatchObject(invalida);

    expect((await transiciones.cerrar(admin.client, id)).error).toBeNull();
    expect(await periodo(id)).toMatchObject({ estado: "cerrado", cerrado_por: admin.id });
    expect((await transiciones.cerrar(admin.client, id)).error).toMatchObject(invalida);
    expect((await transiciones.publicar(admin.client, id)).error).toMatchObject(invalida);

    expect((await transiciones.reabrir(admin.client, id)).error).toBeNull();
    // Back to published: the publication stays as it was, the closing is cleared.
    expect(await periodo(id)).toMatchObject({
      estado: "publicado",
      publicado_at: publicado.publicado_at,
      publicado_por: admin.id,
      cerrado_at: null,
      cerrado_por: null,
    });

    expect((await historialPeriodo(id)).map((h) => [h.accion, h.actor_id])).toEqual([
      ["creado", admin.id],
      ["publicado", admin.id],
      ["cerrado", admin.id],
      ["reabierto", admin.id],
    ]);
  });

  it("a missing period is periodo_inexistente", async () => {
    for (const llamar of Object.values(transiciones)) {
      expect((await llamar(admin.client, randomUUID())).error).toMatchObject({ code: "P0002", hint: "periodo_inexistente" });
    }
  });

  it("an Empleado, an inactive Admin and anon cannot run any of them; nothing changes", async () => {
    const id = await periodoNuevo();
    const antes = { periodo: await periodo(id), historial: await historialPeriodo(id) };
    for (const [quien, cliente] of [
      ["empleado", empleado.client],
      ["admin inactivo", adminInactivo.porToken],
      ["anon", anonClient()],
    ] as const) {
      const crear = await cliente.rpc("recibo_periodo_crear", { p_anio: 2099, p_mes: 12 });
      expect(crear.error?.code, `${quien} crear`).toBe("42501");
      for (const [nombre, llamar] of Object.entries(transiciones)) {
        expect((await llamar(cliente, id)).error?.code, `${quien} ${nombre}`).toBe("42501");
      }
    }
    expect({ periodo: await periodo(id), historial: await historialPeriodo(id) }).toEqual(antes);
  });
});

describe("recibo_registrar", () => {
  const registrar = (
    c: TypedClient,
    periodoId: string,
    empleadoId: string,
    opciones: { path?: string; bytes?: number; reemplazar?: boolean; motivo?: "dni_no_encontrado" | "no_verificable" | "sin_dni" } = {},
  ) =>
    c.rpc("recibo_registrar", {
      p_periodo_id: periodoId,
      p_empleado_id: empleadoId,
      p_archivo_path: opciones.path ?? rutaRecibo(empleadoId, periodoId),
      p_archivo_bytes: opciones.bytes ?? 2048,
      p_reemplazar: opciones.reemplazar ?? false,
      ...(opciones.motivo ? { p_override_motivo: opciones.motivo } : {}),
    });
  const recibo = async (id: string) => (await service.from("recibos").select("*").eq("id", id).single()).data!;
  const overrides = async (id: string) => (await service.from("recibo_overrides").select("motivo, archivo_path, admin_id").eq("recibo_id", id)).data ?? [];
  const historial = async (id: string) => (await service.from("recibo_historial").select("*").eq("recibo_id", id)).data ?? [];

  it("registers a new pending receipt, with no override and no history", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    const path = rutaRecibo(empleado.id, p.id);
    const { data: id, error } = await registrar(admin.client, p.id, empleado.id, { path });
    expect(error).toBeNull();
    expect(await recibo(id!)).toMatchObject({
      periodo_id: p.id,
      empleado_id: empleado.id,
      archivo_path: path,
      archivo_bytes: 2048,
      estado: "pendiente",
      cargado_por: admin.id,
      firmado_at: null,
      firma_id: null,
    });
    expect(await overrides(id!)).toEqual([]);
    expect(await historial(id!)).toEqual([]);
  });

  it("refuses a closed period, and accepts a published one", async () => {
    const cerrado = await nuevoPeriodo(service, admin.id, "cerrado");
    expect((await registrar(admin.client, cerrado.id, empleado.id)).error).toMatchObject({ code: "55000", hint: "periodo_cerrado" });
    const publicado = await nuevoPeriodo(service, admin.id, "publicado");
    expect((await registrar(admin.client, publicado.id, empleado.id)).error).toBeNull();
    expect((await registrar(admin.client, randomUUID(), empleado.id)).error).toMatchObject({ code: "P0002", hint: "periodo_inexistente" });
  });

  it("refuses an Admin, an inactive employee and a nonexistent account as the target", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    for (const destino of [admin.id, empleadoInactivo.id, randomUUID()]) {
      const resultado = await registrar(admin.client, p.id, destino, { path: rutaRecibo(destino, p.id) });
      expect(resultado.error).toMatchObject({ code: "55000", hint: "empleado_no_elegible" });
    }
    expect((await service.from("recibos").select("id").eq("periodo_id", p.id)).data).toEqual([]);
  });

  it("an existing receipt without p_reemplazar is requiere_reemplazo, with whether it is signed", async () => {
    const p = await nuevoPeriodo(service, admin.id, "publicado");
    const id = await nuevoRecibo(service, p.id, empleado.id, admin.id);
    const pendiente = await registrar(admin.client, p.id, empleado.id);
    expect(pendiente.error).toMatchObject({ code: "55000", hint: "requiere_reemplazo", details: "pendiente" });

    const firma = await nuevaFirma(service, empleado.id);
    await firmarRecibo(service, id, empleado.id, firma);
    const firmado = await registrar(admin.client, p.id, empleado.id);
    expect(firmado.error).toMatchObject({ code: "55000", hint: "requiere_reemplazo", details: "firmado" });
  });

  it("replacing a pending receipt copies it to the history exactly and resets the current row", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    const id = await nuevoRecibo(service, p.id, empleado.id, empleado.id);
    const antes = await recibo(id);
    const nuevo = rutaRecibo(empleado.id, p.id);
    const { data, error } = await registrar(admin.client, p.id, empleado.id, { path: nuevo, bytes: 4096, reemplazar: true });
    expect(error).toBeNull();
    expect(data).toBe(id);

    const [copia] = await historial(id);
    expect(copia).toMatchObject({
      recibo_id: id,
      periodo_id: p.id,
      empleado_id: empleado.id,
      archivo_path: antes.archivo_path,
      archivo_bytes: antes.archivo_bytes,
      estado_al_reemplazo: "pendiente",
      firmado_at: null,
      firma_id: null,
      cargado_por: antes.cargado_por,
      cargado_at: antes.cargado_at,
      reemplazado_por: admin.id,
    });
    expect(await recibo(id)).toMatchObject({ archivo_path: nuevo, archivo_bytes: 4096, estado: "pendiente", cargado_por: admin.id });
  });

  it("replacing a signed receipt keeps its signature in the history and the evidence row, and resets to pending", async () => {
    const p = await nuevoPeriodo(service, admin.id, "publicado");
    const id = await nuevoRecibo(service, p.id, otro.id, admin.id);
    const firma = await nuevaFirma(service, otro.id);
    const evidencia = await firmarRecibo(service, id, otro.id, firma);
    const antes = await recibo(id);
    const nuevo = rutaRecibo(otro.id, p.id);

    expect((await registrar(admin.client, p.id, otro.id, { path: nuevo, reemplazar: true })).error).toBeNull();
    const [copia] = await historial(id);
    expect(copia).toMatchObject({
      archivo_path: antes.archivo_path,
      estado_al_reemplazo: "firmado",
      firmado_at: antes.firmado_at,
      firma_id: firma,
      reemplazado_por: admin.id,
    });
    expect(await recibo(id)).toMatchObject({ archivo_path: nuevo, estado: "pendiente", firmado_at: null, firma_id: null });
    expect((await service.from("recibo_firmas").select("id, recibo_id").eq("id", evidencia)).data).toEqual([{ id: evidencia, recibo_id: id }]);
  });

  it("writes an override only with a motivo, naming the new file", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    const sin = await registrar(admin.client, p.id, empleado.id);
    expect(await overrides(sin.data!)).toEqual([]);

    const nuevo = rutaRecibo(empleado.id, p.id);
    const con = await registrar(admin.client, p.id, empleado.id, { path: nuevo, reemplazar: true, motivo: "sin_dni" });
    expect(con.error).toBeNull();
    expect(await overrides(con.data!)).toEqual([{ motivo: "sin_dni", archivo_path: nuevo, admin_id: admin.id }]);
  });

  it("refuses another employee's or period's path (F2-03 constraints) and the current file as its own replacement", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    const otroPeriodo = await nuevoPeriodo(service, admin.id, "borrador");
    for (const path of [rutaRecibo(otro.id, p.id), rutaRecibo(empleado.id, otroPeriodo.id)]) {
      expect((await registrar(admin.client, p.id, empleado.id, { path })).error?.code, path).toBe("23514");
    }
    const id = (await registrar(admin.client, p.id, empleado.id)).data!;
    const { archivo_path } = await recibo(id);
    const repetido = await registrar(admin.client, p.id, empleado.id, { path: archivo_path, reemplazar: true });
    expect(repetido.error).toMatchObject({ code: "22023", hint: "archivo_repetido" });
    expect(await historial(id)).toEqual([]);
  });

  it("an Empleado, an inactive Admin and anon cannot register", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    for (const cliente of [empleado.client, adminInactivo.porToken, anonClient()]) {
      expect((await registrar(cliente, p.id, empleado.id)).error?.code).toBe("42501");
    }
    expect((await service.from("recibos").select("id").eq("periodo_id", p.id)).data).toEqual([]);
  });
});

describe("signed receipt guard and path indexes", () => {
  it("refuses a direct firmado -> pendiente update without the history row, also for the service role", async () => {
    const p = await nuevoPeriodo(service, admin.id, "publicado");
    const id = await nuevoRecibo(service, p.id, otro.id, admin.id);
    const firma = await nuevaFirma(service, otro.id);
    await firmarRecibo(service, id, otro.id, firma);
    const intento = await service.from("recibos").update({ estado: "pendiente", firmado_at: null, firma_id: null }).eq("id", id);
    expect(intento.error).toMatchObject({ code: "55000", hint: "recibo_firmado" });
    expect(await service.from("recibos").select("estado").eq("id", id).single()).toMatchObject({ data: { estado: "firmado" } });
  });

  // recibos: a path names its owner and period (F2-03 CHECK), and an
  // employee has one receipt per period, so two receipts can never share a
  // path; the unique index makes that explicit and serves the lookups. A
  // signature path names only its owner: there the index is the one guard.
  it("a stored file is held by one row: the unique path indexes", async () => {
    const p = await nuevoPeriodo(service, admin.id, "borrador");
    const id = await nuevoRecibo(service, p.id, empleado.id, admin.id);
    const { archivo_path } = (await service.from("recibos").select("archivo_path").eq("id", id).single()).data!;
    const otraFila = await service
      .from("recibos")
      .insert({ periodo_id: p.id, empleado_id: empleado.id, archivo_path, archivo_bytes: 10, cargado_por: admin.id });
    expect(otraFila.error?.code).toBe("23505");

    const firmante = await createTestUser(service, "carga-fn-firmas");
    cuentas.push(firmante.id);
    await nuevaFirma(service, firmante.id);
    const { data: v1 } = await service.from("firmas_empleado").select("id, imagen_path").eq("empleado_id", firmante.id).single();
    expect((await service.from("firmas_empleado").update({ activa: false }).eq("id", v1!.id)).error).toBeNull();
    const repetida = await service
      .from("firmas_empleado")
      .insert({ empleado_id: firmante.id, version: 2, imagen_path: v1!.imagen_path, activa: true });
    expect(repetida.error?.code).toBe("23505");
    expect(repetida.error?.message).toContain("firmas_empleado_imagen_path_key");
  });
});
