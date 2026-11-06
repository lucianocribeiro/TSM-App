import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { crearDesactivado } from "./actores";
import { anonClient, createTestUser, deleteTestUsers, serviceClient, type TestUser } from "./helpers";
import { borrarReciboYPeriodo, despejarRetenidos, firmarRecibo, nuevaFirma, nuevoPeriodo, nuevoRecibo, ponerEstadoPeriodo } from "./recibos";

// F2-02, receipts schema (PRD Fase 2 v0.4, Constitution §11). The access
// matrix (matriz-acceso.ts) covers every table for every actor and
// operation: isolation between employees, Admin-only tables, Admin reads
// all, no direct write for any API role, anon and inactive accounts. This
// file covers what depends on state: draft periods, the append-only rules
// (even for the service role), the constraints, the Mis Recibos counter, and
// that an account with receipts cannot be removed (purge included).
//
// Accounts that end up with evidence or history rows cannot be removed by
// design (./recibos.ts); the rest are removed in afterAll.

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

const cuentas = await import("@/lib/admin/cuentas");

const INMUTABLE = "55000";

describe("receipts schema (F2-02)", () => {
  const service = serviceClient();
  let admin: TestUser;
  let empleado: TestUser;
  let otro: TestUser;
  const usuarios: string[] = [];
  // Receipts and periods with no evidence or history, removed in afterAll.
  const limpieza: { recibo: string | null; periodo: string }[] = [];

  async function periodo(estado: "borrador" | "publicado" | "cerrado") {
    const p = await nuevoPeriodo(service, admin.id, estado);
    limpieza.push({ recibo: null, periodo: p.id });
    return p.id;
  }

  async function recibo(periodoId: string, user: TestUser) {
    const id = await nuevoRecibo(service, periodoId, user.id, admin.id);
    limpieza.unshift({ recibo: id, periodo: periodoId });
    return id;
  }

  beforeAll(async () => {
    admin = await createTestUser(service, "recibos-admin", "admin");
    empleado = await createTestUser(service, "recibos-empleado");
    otro = await createTestUser(service, "recibos-otro");
    usuarios.push(empleado.id, otro.id, admin.id);
  }, 60_000);

  afterAll(async () => {
    session.client = null;
    for (const { recibo: id, periodo: p } of limpieza) await borrarReciboYPeriodo(service, id, p);
    await despejarRetenidos(service, usuarios);
    await deleteTestUsers(service, usuarios);
  });

  describe("draft periods", () => {
    it("an Empleado reads nothing of a draft period, and both period and receipt once it is published or closed", async () => {
      const p = await periodo("borrador");
      const r = await recibo(p, empleado);
      const ver = async () => ({
        periodo: (await empleado.client.from("recibo_periodos").select("id").eq("id", p)).data,
        recibo: (await empleado.client.from("recibos").select("id").eq("id", r)).data,
      });

      expect(await ver()).toEqual({ periodo: [], recibo: [] });
      // The Admin sees the draft and its receipt.
      expect((await admin.client.from("recibo_periodos").select("id").eq("id", p)).data).toEqual([{ id: p }]);
      expect((await admin.client.from("recibos").select("id").eq("id", r)).data).toEqual([{ id: r }]);

      for (const estado of ["publicado", "cerrado"] as const) {
        await ponerEstadoPeriodo(service, p, estado, admin.id);
        expect(await ver(), estado).toEqual({ periodo: [{ id: p }], recibo: [{ id: r }] });
      }
      // Back to draft (re-opening never does this, but the rule holds).
      await ponerEstadoPeriodo(service, p, "borrador", admin.id);
      expect(await ver()).toEqual({ periodo: [], recibo: [] });
    });

    it("another employee's receipt stays out of reach in a published period", async () => {
      const p = await periodo("publicado");
      const r = await recibo(p, otro);
      expect((await empleado.client.from("recibos").select("id").eq("id", r)).data).toEqual([]);
      expect((await otro.client.from("recibos").select("id").eq("id", r)).data).toEqual([{ id: r }]);
    });
  });

  describe("append-only rows, the service role included", () => {
    it("signature evidence and the three logs refuse UPDATE and DELETE", async () => {
      const p = await nuevoPeriodo(service, admin.id, "publicado");
      const r = await nuevoRecibo(service, p.id, empleado.id, admin.id);
      const firma = await nuevaFirma(service, empleado.id);
      const evidencia = await firmarRecibo(service, r, empleado.id, firma);
      const historial = await service
        .from("recibo_historial")
        .insert({
          recibo_id: r,
          periodo_id: p.id,
          empleado_id: empleado.id,
          archivo_path: `${empleado.id}/${p.id}/anterior.pdf`,
          archivo_bytes: 10,
          estado_al_reemplazo: "pendiente",
          cargado_por: admin.id,
          cargado_at: new Date().toISOString(),
          reemplazado_por: admin.id,
        })
        .select("id")
        .single();
      const override = await service
        .from("recibo_overrides")
        .insert({ recibo_id: r, motivo: "dni_no_encontrado", archivo_path: `${empleado.id}/${p.id}/anterior.pdf`, admin_id: admin.id })
        .select("id")
        .single();
      const log = await service.from("recibo_periodo_historial").insert({ periodo_id: p.id, accion: "publicado", actor_id: admin.id }).select("id").single();
      expect([historial.error, override.error, log.error]).toEqual([null, null, null]);

      const intentos = [
        service.from("recibo_firmas").update({ firmado_at: new Date().toISOString() }).eq("id", evidencia),
        service.from("recibo_firmas").delete().eq("id", evidencia),
        service.from("recibo_historial").update({ archivo_bytes: 11 }).eq("id", historial.data!.id),
        service.from("recibo_historial").delete().eq("id", historial.data!.id),
        service.from("recibo_overrides").update({ motivo: "sin_dni" }).eq("id", override.data!.id),
        service.from("recibo_overrides").delete().eq("id", override.data!.id),
        service.from("recibo_periodo_historial").update({ accion: "cerrado" }).eq("id", log.data!.id),
        service.from("recibo_periodo_historial").delete().eq("id", log.data!.id),
      ];
      for (const [i, intento] of intentos.entries()) {
        const { error } = await intento;
        expect(error?.code, String(i)).toBe(INMUTABLE);
        expect(error?.hint, String(i)).toBe("registro_inmutable");
      }
      expect((await service.from("recibo_firmas").select("id").eq("id", evidencia)).data).toEqual([{ id: evidencia }]);
      expect((await service.from("recibo_historial").select("archivo_bytes").eq("id", historial.data!.id)).data).toEqual([{ archivo_bytes: 10 }]);
      expect((await service.from("recibo_overrides").select("motivo").eq("id", override.data!.id)).data).toEqual([{ motivo: "dni_no_encontrado" }]);
      expect((await service.from("recibo_periodo_historial").select("accion").eq("id", log.data!.id)).data).toEqual([{ accion: "publicado" }]);
    });

    it("a registered signature is never deleted, and only retiring the active one is allowed", async () => {
      const firma = await nuevaFirma(service, otro.id);
      const { data: creada } = await service.from("firmas_empleado").select("version, imagen_path").eq("id", firma).single();
      expect((await service.from("firmas_empleado").delete().eq("id", firma)).error?.code).toBe(INMUTABLE);
      for (const cambio of [{ imagen_path: "otra.png" }, { version: 50 }, { activa: false, imagen_path: "otra.png" }]) {
        const { error } = await service.from("firmas_empleado").update(cambio).eq("id", firma);
        expect(error?.code, JSON.stringify(cambio)).toBe(INMUTABLE);
        expect(error?.hint, JSON.stringify(cambio)).toBe("firma_inmutable");
      }
      expect((await service.from("firmas_empleado").update({ activa: false }).eq("id", firma)).error).toBeNull();
      // Not back to active.
      expect((await service.from("firmas_empleado").update({ activa: true }).eq("id", firma)).error?.code).toBe(INMUTABLE);
      expect((await service.from("firmas_empleado").select("version, imagen_path, activa").eq("id", firma)).data).toEqual([
        { ...creada, activa: false },
      ]);
    });

    it("a signed receipt does not go back to pending", async () => {
      const p = await nuevoPeriodo(service, admin.id, "publicado");
      const r = await nuevoRecibo(service, p.id, otro.id, admin.id);
      const firma = await nuevaFirma(service, otro.id);
      await firmarRecibo(service, r, otro.id, firma);
      const { error } = await service.from("recibos").update({ estado: "pendiente", firmado_at: null, firma_id: null }).eq("id", r);
      expect(error?.code).toBe(INMUTABLE);
      expect(error?.hint).toBe("recibo_firmado");
      expect((await service.from("recibos").select("estado").eq("id", r)).data).toEqual([{ estado: "firmado" }]);
    });
  });

  describe("constraints", () => {
    it("one receipt per employee per period", async () => {
      const p = await periodo("borrador");
      await recibo(p, empleado);
      const { error } = await service
        .from("recibos")
        .insert({ periodo_id: p, empleado_id: empleado.id, archivo_path: `${empleado.id}/${p}/otro.pdf`, archivo_bytes: 1, cargado_por: admin.id });
      expect(error?.code).toBe("23505");
    });

    it("one period per month, and month and year in range", async () => {
      const p = await nuevoPeriodo(service, admin.id, "borrador");
      limpieza.push({ recibo: null, periodo: p.id });
      expect((await service.from("recibo_periodos").insert({ anio: p.anio, mes: p.mes, created_by: admin.id })).error?.code).toBe("23505");
      for (const [anio, mes] of [[1999, 1], [2101, 1], [2050, 0], [2050, 13]]) {
        const { error } = await service.from("recibo_periodos").insert({ anio, mes, created_by: admin.id });
        expect(error?.code, `${anio}-${mes}`).toBe("23514");
      }
      // A published period has its publication date; a closed one its closing date.
      expect((await service.from("recibo_periodos").update({ estado: "publicado" }).eq("id", p.id)).error?.code).toBe("23514");
      expect(
        (await service.from("recibo_periodos").update({ estado: "cerrado", publicado_at: new Date().toISOString() }).eq("id", p.id)).error
          ?.code,
      ).toBe("23514");
    });

    it("one active signature per employee", async () => {
      await nuevaFirma(service, otro.id);
      const { data: activa } = await service.from("firmas_empleado").select("version").eq("empleado_id", otro.id).eq("activa", true).single();
      const { error } = await service
        .from("firmas_empleado")
        .insert({ empleado_id: otro.id, version: (activa?.version ?? 0) + 1, imagen_path: `${otro.id}/x.png`, activa: true });
      expect(error?.code).toBe("23505");
      // The same version twice.
      const repetida = await service
        .from("firmas_empleado")
        .insert({ empleado_id: otro.id, version: activa?.version ?? 1, imagen_path: `${otro.id}/x.png`, activa: false });
      expect(repetida.error?.code).toBe("23505");
    });

    it("firmado needs the signature date and the signature; pendiente has neither", async () => {
      const p = await periodo("publicado");
      const r = await recibo(p, empleado);
      const firma = await nuevaFirma(service, empleado.id);
      const ahora = new Date().toISOString();
      for (const cambio of [
        { estado: "firmado" as const },
        { estado: "firmado" as const, firmado_at: ahora },
        { estado: "firmado" as const, firma_id: firma },
        { firmado_at: ahora },
        { firma_id: firma },
      ]) {
        expect((await service.from("recibos").update(cambio).eq("id", r)).error?.code, JSON.stringify(Object.keys(cambio))).toBe("23514");
      }
      expect((await service.from("recibos").select("estado, firmado_at, firma_id").eq("id", r)).data).toEqual([
        { estado: "pendiente", firmado_at: null, firma_id: null },
      ]);
    });

    it("a receipt is signed only with the employee's own signature, and the evidence matches receipt and signature", async () => {
      const p = await periodo("publicado");
      const r = await recibo(p, empleado);
      const ajena = await nuevaFirma(service, otro.id);
      const propia = await nuevaFirma(service, empleado.id);
      const firmarCon = await service
        .from("recibos")
        .update({ estado: "firmado", firmado_at: new Date().toISOString(), firma_id: ajena })
        .eq("id", r);
      expect(firmarCon.error?.code).toBe("23503");
      for (const fila of [
        // Another employee as the signer of this receipt.
        { recibo_id: r, empleado_id: otro.id, firma_id: ajena },
        // The receipt's employee with another employee's signature.
        { recibo_id: r, empleado_id: empleado.id, firma_id: ajena },
      ]) {
        expect((await service.from("recibo_firmas").insert(fila)).error?.code, JSON.stringify(fila)).toBe("23503");
      }
      expect((await service.from("recibo_firmas").select("id").eq("recibo_id", r)).data).toEqual([]);
      expect(propia).toBeTruthy();
    });
  });

  describe("Mis Recibos counter", () => {
    it("counts only the caller's pending receipts in non-draft periods; anon cannot run it", async () => {
      const contador = await createTestUser(service, "recibos-contador");
      usuarios.unshift(contador.id);
      const publicado = await periodo("publicado");
      const cerrado = await periodo("cerrado");
      const borrador = await periodo("borrador");
      const firmado = await periodo("publicado");
      await recibo(publicado, contador);
      await recibo(cerrado, contador);
      await recibo(borrador, contador);
      // Signed: not pending.
      const r = await nuevoRecibo(service, firmado, contador.id, admin.id);
      await firmarRecibo(service, r, contador.id, await nuevaFirma(service, contador.id));
      // Another employee's pending receipt in a published period.
      await recibo(publicado, otro);

      expect(await contador.client.rpc("mis_recibos_pendientes_count")).toMatchObject({ data: 2, error: null });
      expect((await admin.client.rpc("mis_recibos_pendientes_count")).data).toBe(0);
      expect((await anonClient().rpc("mis_recibos_pendientes_count")).error?.code).toBe("42501");
    });

    it("an inactive account reads 0, and no receipt row, with its own pending receipt", async () => {
      const inactivo = await crearDesactivado(service, admin, "recibos-inactivo");
      usuarios.unshift(inactivo.id);
      const p = await periodo("publicado");
      await recibo(p, inactivo);
      expect(await inactivo.porToken.rpc("mis_recibos_pendientes_count")).toMatchObject({ data: 0, error: null });
      expect((await inactivo.porToken.from("recibos").select("id")).data).toEqual([]);
    });
  });

  describe("accounts with receipts stay", () => {
    it("deleting a referenced profile directly fails (ON DELETE RESTRICT)", async () => {
      const titular = await createTestUser(service, "recibos-restrict");
      usuarios.unshift(titular.id);
      const p = await periodo("borrador");
      await recibo(p, titular);
      expect((await service.from("profiles").delete().eq("id", titular.id)).error?.code).toBe("23503");
      expect((await service.auth.admin.deleteUser(titular.id)).error).not.toBeNull();
      expect((await service.from("profiles").select("id").eq("id", titular.id)).data).toEqual([{ id: titular.id }]);
    });

    it("the purge refuses an account with a receipt with its own message, and still purges one without", async () => {
      const conRecibo = await createTestUser(service, "recibos-purga");
      const sinRecibo = await createTestUser(service, "recibos-purga-libre");
      usuarios.unshift(conRecibo.id, sinRecibo.id);
      const p = await periodo("publicado");
      await recibo(p, conRecibo);

      session.client = admin.client;
      expect(await cuentas.purgarCuenta({ profileId: conRecibo.id, emailConfirmacion: conRecibo.email })).toEqual({
        ok: false,
        error: copy.cuentas.errors.tieneRecibos,
      });
      expect((await service.from("profiles").select("id").eq("id", conRecibo.id)).data).toEqual([{ id: conRecibo.id }]);
      expect((await service.auth.admin.getUserById(conRecibo.id)).data.user?.id).toBe(conRecibo.id);

      const libre = await cuentas.purgarCuenta({ profileId: sinRecibo.id, emailConfirmacion: sinRecibo.email });
      expect(libre.ok).toBe(true);
      expect((await service.from("profiles").select("id").eq("id", sinRecibo.id)).data).toEqual([]);
    });
  });
});
