import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { legajoIdDe } from "./actores";
import { createTestUser, deleteTestUsers, serviceClient, type TestUser } from "./helpers";
import { escribirLaboral, itemId, laboralCompleto, laboralDe, type LaboralUpdate } from "./laborales";

// CR-5, against the local stack:
// - legajos_laborales_validar: Convenio is required (insert and update), and
//   the "No" convenio leaves Tarea and Categoría empty; other convenios keep
//   them optional. The service role is checked too.
// - A Puesto's Sucursal por defecto: Puesto only, a Sucursal only, an inactive
//   one not newly chosen, a Sucursal in use as a default not deletable; the
//   change bumps the version and is recorded in the history.
// - The "No" convenio is a system item: it cannot be deleted, deactivated,
//   renamed or unmarked, by the Admin's session or the service role; it can
//   be reordered; there is never a second one; its seed is idempotent.
// The Configuración actions run with the Admin's session (as in
// configuracion.test.ts), so RLS decides as in the app.

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

const configuracion = await import("@/app/(app)/configuracion/actions");

const errors = copy.configuracion.errors;
const fallo = (error: string) => ({ ok: false, error });
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE_VIOLATION = "23505";
const PERMISSION_DENIED = "42501";
const OBJECT_STATE = "55000";

describe("datos laborales rules (CR-5)", () => {
  const service = serviceClient();
  const marca = `CR5 ${randomUUID().slice(0, 8)}`;
  let admin: TestUser;
  let empleado: TestUser;
  let legajo: string;
  let completo: LaboralUpdate;
  let sinConvenio: string;
  let comercio: string;

  // A fresh item (no history: written with the service role).
  async function nuevoItem(lista: "area" | "puesto" | "sucursal" | "convenio" | "tarea", nombre: string, areaId: string | null = null) {
    const { data, error } = await service
      .from("catalogo_items")
      .insert({ lista, nombre: `${marca} ${nombre}`, area_id: areaId })
      .select("*")
      .single();
    if (error || !data) throw new Error(`item insert failed: ${error?.message}`);
    return data;
  }
  async function fila(id: string) {
    const { data } = await service.from("catalogo_items").select("*").eq("id", id).single();
    return data!;
  }
  async function eventos(itemIdBuscado: string) {
    const { data } = await service
      .from("catalogo_eventos")
      .select("accion, valor_anterior, valor_nuevo, actor_id, item_nombre, area_nombre, lista")
      .eq("item_id", itemIdBuscado)
      .order("secuencia");
    return data ?? [];
  }
  async function itemNo() {
    const { data, error } = await service.from("catalogo_items").select("*").eq("lista", "convenio").eq("sin_convenio", true);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    return data![0];
  }

  beforeAll(async () => {
    admin = await createTestUser(service, "cr5-admin", "admin");
    empleado = await createTestUser(service, "cr5-empleado");
    legajo = await legajoIdDe(service, empleado.id);
    completo = await laboralCompleto(service, "CR5");
    await escribirLaboral(service, legajo, completo);
    sinConvenio = (await itemNo()).id;
    comercio = await itemId(service, "convenio", "Comercio");
    session.client = admin.client;
  }, 60_000);

  afterAll(async () => {
    session.client = null;
    // The history names the Admin and the test items: it goes first.
    await service.from("catalogo_eventos").delete().eq("actor_id", admin.id);
    await deleteTestUsers(service, [admin.id, empleado.id]);
    await service.from("catalogo_items").update({ sucursal_defecto_id: null }).like("nombre", `${marca}%`);
    await service.from("catalogo_items").delete().like("nombre", `${marca}%`).eq("lista", "puesto");
    await service.from("catalogo_items").delete().like("nombre", `${marca}%`);
  });

  // -------------------------------------------------------------------------
  describe("legajos_laborales_validar", () => {
    async function rechazo(cambio: LaboralUpdate, hint: string) {
      const antes = await laboralDe(service, legajo);
      for (const cliente of [admin.client, service]) {
        const { data, error } = await cliente.from("legajos_laborales").update(cambio).eq("legajo_id", legajo).select();
        expect(error?.code, JSON.stringify(cambio)).toBe(CHECK_VIOLATION);
        expect(error?.hint, JSON.stringify(cambio)).toBe(hint);
        expect(data).toBeNull();
      }
      expect(await laboralDe(service, legajo)).toEqual(antes);
    }
    async function acepta(cambio: LaboralUpdate) {
      const { error } = await admin.client.from("legajos_laborales").update(cambio).eq("legajo_id", legajo);
      expect(error, JSON.stringify(cambio)).toBeNull();
      expect(await laboralDe(service, legajo)).toMatchObject(cambio);
    }

    it("refuses a missing Convenio on update, the service role's too", async () => {
      await rechazo({ convenio_id: null }, "laborales_incompletos");
      await rechazo({ ...completo, numero_legajo: `C-${randomUUID().slice(0, 8)}`, convenio_id: null }, "laborales_incompletos");
    });

    it("refuses a missing Convenio on insert", async () => {
      const nuevo = await createTestUser(service, "cr5-insert");
      try {
        const id = await legajoIdDe(service, nuevo.id);
        // The row every legajo gets is removed, so the Admin inserts it.
        await service.from("legajos_laborales").delete().eq("legajo_id", id);
        const valores = { ...(await laboralCompleto(service, "CR5I")), legajo_id: id };
        const sin = await admin.client.from("legajos_laborales").insert({ ...valores, convenio_id: null }).select();
        expect(sin.error?.code).toBe(CHECK_VIOLATION);
        expect(sin.error?.hint).toBe("laborales_incompletos");
        const servicio = await service.from("legajos_laborales").insert({ ...valores, convenio_id: null });
        expect(servicio.error?.hint).toBe("laborales_incompletos");
        expect((await service.from("legajos_laborales").select("legajo_id").eq("legajo_id", id)).data).toEqual([]);

        const ok = await admin.client.from("legajos_laborales").insert(valores).select("convenio_id");
        expect(ok.error).toBeNull();
        expect(ok.data).toEqual([{ convenio_id: valores.convenio_id }]);
      } finally {
        await deleteTestUsers(service, [nuevo.id]);
      }
    });

    it("refuses the No convenio with a Tarea or a Categoría", async () => {
      await rechazo({ convenio_id: sinConvenio, categoria_id: null }, "sin_convenio");
      await rechazo({ convenio_id: sinConvenio, tarea_id: null }, "sin_convenio");
      await rechazo({ convenio_id: sinConvenio }, "sin_convenio");
    });

    it("accepts the No convenio without them, and Comercio with or without them", async () => {
      await acepta({ convenio_id: sinConvenio, tarea_id: null, categoria_id: null });
      // Kept as No: another change does not reopen Tarea or Categoría.
      await rechazo({ tarea_id: completo.tarea_id }, "sin_convenio");
      await acepta({ convenio_id: comercio });
      await acepta({ tarea_id: completo.tarea_id, categoria_id: completo.categoria_id });
      await acepta({ tarea_id: null, categoria_id: null });
      await escribirLaboral(service, legajo, completo);
    });
  });

  // -------------------------------------------------------------------------
  describe("Sucursal por defecto", () => {
    it("is set and cleared by the Admin with a version bump and a history row, in names", async () => {
      const area = await nuevoItem("area", "Ventas");
      const puesto = await nuevoItem("puesto", "Mostrador", area.id);
      const norte = await nuevoItem("sucursal", "Norte");
      const sur = await nuevoItem("sucursal", "Sur");

      expect(await configuracion.asignarSucursalDefecto({ id: puesto.id, version: puesto.version, sucursalId: norte.id })).toEqual({ ok: true });
      const conNorte = await fila(puesto.id);
      expect(conNorte).toMatchObject({ sucursal_defecto_id: norte.id, version: puesto.version + 1 });
      // A stale version is refused.
      expect(await configuracion.asignarSucursalDefecto({ id: puesto.id, version: puesto.version, sucursalId: sur.id })).toEqual(
        fallo(errors.cambioConcurrente),
      );
      expect(await configuracion.asignarSucursalDefecto({ id: puesto.id, version: conNorte.version, sucursalId: sur.id })).toEqual({ ok: true });
      const conSur = await fila(puesto.id);
      expect(await configuracion.asignarSucursalDefecto({ id: puesto.id, version: conSur.version, sucursalId: null })).toEqual({ ok: true });
      expect(await fila(puesto.id)).toMatchObject({ sucursal_defecto_id: null, version: puesto.version + 3 });

      const base = { accion: "sucursal_defecto", actor_id: admin.id, item_nombre: puesto.nombre, area_nombre: area.nombre, lista: "puesto" };
      expect(await eventos(puesto.id)).toEqual([
        { ...base, valor_anterior: null, valor_nuevo: norte.nombre },
        { ...base, valor_anterior: norte.nombre, valor_nuevo: sur.nombre },
        { ...base, valor_anterior: sur.nombre, valor_nuevo: null },
      ]);
    });

    it("refuses an extra key, even one set to undefined, with no version bump and no history row (AUDCR5-01)", async () => {
      const area = await nuevoItem("area", "Estricto");
      const puesto = await nuevoItem("puesto", "Estricto", area.id);
      const sucursal = await nuevoItem("sucursal", "Estricta");
      const valido = { id: puesto.id, version: puesto.version, sucursalId: sucursal.id };
      for (const extra of [{ extra: 1 }, { extra: undefined }, { version_nueva: 9 }]) {
        expect(await configuracion.asignarSucursalDefecto({ ...valido, ...extra }), Object.keys(extra)[0]).toEqual(fallo(errors.accionFallo));
      }
      expect(await fila(puesto.id)).toEqual(puesto);
      expect(await eventos(puesto.id)).toEqual([]);
      // The same input without the extra key is applied as before.
      expect(await configuracion.asignarSucursalDefecto(valido)).toEqual({ ok: true });
      expect(await fila(puesto.id)).toMatchObject({ sucursal_defecto_id: sucursal.id, version: puesto.version + 1 });
      expect(await eventos(puesto.id)).toHaveLength(1);
    });

    it("is for a Puesto only, and names a Sucursal only", async () => {
      const norte = await nuevoItem("sucursal", "Solo puesto");
      const tarea = await nuevoItem("tarea", "No es puesto");
      const area = await nuevoItem("area", "Área lista");
      const puesto = await nuevoItem("puesto", "Puesto lista", area.id);

      const enTarea = await service.from("catalogo_items").update({ sucursal_defecto_id: norte.id }).eq("id", tarea.id).select();
      expect(enTarea.error?.code).toBe(CHECK_VIOLATION);
      expect(enTarea.error?.message).toContain("catalogo_items_sucursal_defecto_solo_puesto");
      expect(await configuracion.asignarSucursalDefecto({ id: tarea.id, version: tarea.version, sucursalId: norte.id })).toEqual(
        fallo(errors.accionFallo),
      );

      for (const otro of [tarea.id, area.id, randomUUID()]) {
        const directo = await admin.client.from("catalogo_items").update({ sucursal_defecto_id: otro }).eq("id", puesto.id).select();
        expect(directo.error?.code, otro).toBe(FOREIGN_KEY);
        expect(await configuracion.asignarSucursalDefecto({ id: puesto.id, version: puesto.version, sucursalId: otro })).toEqual(
          fallo(errors.sucursalInvalida),
        );
      }
      expect(await fila(puesto.id)).toEqual(puesto);
      expect(await fila(tarea.id)).toEqual(tarea);
    });

    it("a Sucursal used as a default cannot be deleted, can be deactivated, and is not newly chosen while inactive", async () => {
      const area = await nuevoItem("area", "Área en uso");
      const puesto = await nuevoItem("puesto", "Puesto en uso", area.id);
      const otroPuesto = await nuevoItem("puesto", "Otro puesto", area.id);
      const sucursal = await nuevoItem("sucursal", "En uso");
      expect(await configuracion.asignarSucursalDefecto({ id: puesto.id, version: puesto.version, sucursalId: sucursal.id })).toEqual({ ok: true });

      const directo = await admin.client.from("catalogo_items").delete().eq("id", sucursal.id).select("id");
      expect(directo.error?.code).toBe(FOREIGN_KEY);
      expect(await configuracion.eliminarItem({ id: sucursal.id, version: sucursal.version })).toEqual(fallo(errors.enUso));
      expect((await service.from("catalogo_items").delete().eq("id", sucursal.id).select("id")).error?.code).toBe(FOREIGN_KEY);
      expect(await fila(sucursal.id)).toEqual(sucursal);

      expect(await configuracion.desactivarItem({ id: sucursal.id, version: sucursal.version })).toEqual({ ok: true });
      // The Puesto keeps it through another change.
      const conDefecto = await fila(puesto.id);
      const renombre = await admin.client.from("catalogo_items").update({ nombre: `${marca} Puesto renombrado` }).eq("id", puesto.id).select("sucursal_defecto_id");
      expect(renombre.error).toBeNull();
      expect(renombre.data).toEqual([{ sucursal_defecto_id: sucursal.id }]);
      expect(conDefecto.sucursal_defecto_id).toBe(sucursal.id);

      // Newly chosen while inactive: refused by the action and the database.
      expect(await configuracion.asignarSucursalDefecto({ id: otroPuesto.id, version: otroPuesto.version, sucursalId: sucursal.id })).toEqual(
        fallo(errors.sucursalInvalida),
      );
      for (const cliente of [admin.client, service]) {
        const { error } = await cliente.from("catalogo_items").update({ sucursal_defecto_id: sucursal.id }).eq("id", otroPuesto.id).select();
        expect(error?.code).toBe(CHECK_VIOLATION);
        expect(error?.hint).toBe("item_inactivo");
      }
      expect(await fila(otroPuesto.id)).toEqual(otroPuesto);

      // Once no Puesto has it, it can be deleted.
      await service.from("catalogo_items").update({ sucursal_defecto_id: null }).eq("id", puesto.id);
      const libre = await fila(sucursal.id);
      expect(await configuracion.eliminarItem({ id: libre.id, version: libre.version })).toEqual({ ok: true });
    });

    it("an Empleado cannot read or write it", async () => {
      const area = await nuevoItem("area", "Área empleado");
      const puesto = await nuevoItem("puesto", "Puesto empleado", area.id);
      const sucursal = await nuevoItem("sucursal", "Empleado");
      const lectura = await empleado.client.from("catalogo_items").select("id, sucursal_defecto_id, sin_convenio").eq("id", puesto.id);
      expect(lectura.error).toBeNull();
      expect(lectura.data).toEqual([]);
      const cambio = await empleado.client.from("catalogo_items").update({ sucursal_defecto_id: sucursal.id }).eq("id", puesto.id).select("id");
      expect(cambio.error).toBeNull();
      expect(cambio.data).toEqual([]);
      expect(await fila(puesto.id)).toEqual(puesto);
    });
  });

  // -------------------------------------------------------------------------
  describe('the "No" convenio (system item)', () => {
    it("exists once, active, named No, in the convenio list", async () => {
      expect(await itemNo()).toMatchObject({ lista: "convenio", nombre: "No", activo: true, sin_convenio: true, area_id: null });
    });

    it("cannot be deleted, deactivated, renamed or unmarked, by the Admin or the service role", async () => {
      const no = await itemNo();
      const intentos = [
        ["delete admin", admin.client.from("catalogo_items").delete().eq("id", no.id).select("id"), OBJECT_STATE],
        ["delete service", service.from("catalogo_items").delete().eq("id", no.id).select("id"), OBJECT_STATE],
        ["deactivate admin", admin.client.from("catalogo_items").update({ activo: false }).eq("id", no.id).select("id"), OBJECT_STATE],
        ["deactivate service", service.from("catalogo_items").update({ activo: false }).eq("id", no.id).select("id"), OBJECT_STATE],
        ["rename admin", admin.client.from("catalogo_items").update({ nombre: "Ninguno" }).eq("id", no.id).select("id"), OBJECT_STATE],
        ["rename service", service.from("catalogo_items").update({ nombre: "Ninguno" }).eq("id", no.id).select("id"), OBJECT_STATE],
        // The mark is not granted to the API roles at all.
        ["unmark admin", admin.client.from("catalogo_items").update({ sin_convenio: false }).eq("id", no.id).select("id"), PERMISSION_DENIED],
        ["unmark service", service.from("catalogo_items").update({ sin_convenio: false }).eq("id", no.id).select("id"), OBJECT_STATE],
      ] as const;
      for (const [nombre, consulta, code] of intentos) {
        const { data, error } = await consulta;
        expect(error?.code, nombre).toBe(code);
        if (code === OBJECT_STATE) expect(error?.hint, nombre).toBe("item_sistema");
        expect(data, nombre).toBeNull();
      }

      expect(await configuracion.renombrarItem({ id: no.id, version: no.version, nombre: "Ninguno" })).toEqual(fallo(errors.itemSistema));
      expect(await configuracion.desactivarItem({ id: no.id, version: no.version })).toEqual(fallo(errors.itemSistema));
      expect(await configuracion.eliminarItem({ id: no.id, version: no.version })).toEqual(fallo(errors.itemSistema));
      expect(await itemNo()).toEqual(no);
      expect(await eventos(no.id)).toEqual([]);
    });

    it("can be reordered", async () => {
      const no = await itemNo();
      const { data: grupo } = await service.from("catalogo_items").select("id, posicion").eq("lista", "convenio").order("posicion");
      const direccion = grupo![0].id === no.id ? "abajo" : "arriba";
      const vuelta = direccion === "abajo" ? "arriba" : "abajo";
      expect(await configuracion.moverItem({ id: no.id, version: no.version, direccion })).toEqual({ ok: true });
      const movido = await itemNo();
      expect(movido.posicion).not.toBe(no.posicion);
      expect(await configuracion.moverItem({ id: no.id, version: movido.version, direccion: vuelta })).toEqual({ ok: true });
      expect((await itemNo()).posicion).toBe(no.posicion);
      expect((await eventos(no.id)).map((evento) => evento.accion)).toEqual(["reorden", "reorden"]);
    });

    it("a second sin convenio item is refused, and the mark is for the convenio list only", async () => {
      const segundo = await service.from("catalogo_items").insert({ lista: "convenio", nombre: `${marca} Otro no`, sin_convenio: true }).select();
      expect(segundo.error?.code).toBe(UNIQUE_VIOLATION);
      const otro = await nuevoItem("convenio", "Marcable");
      const marcar = await service.from("catalogo_items").update({ sin_convenio: true }).eq("id", otro.id).select();
      expect(marcar.error?.code).toBe(UNIQUE_VIOLATION);
      const enTarea = await service.from("catalogo_items").insert({ lista: "tarea", nombre: `${marca} Tarea no`, sin_convenio: true }).select();
      expect(enTarea.error?.code).toBe(CHECK_VIOLATION);
      expect(enTarea.error?.message).toContain("catalogo_items_sin_convenio_solo_convenio");
      // The Admin cannot set the mark either (no grant).
      const porAdmin = await admin.client.from("catalogo_items").insert({ lista: "convenio", nombre: `${marca} Admin no`, sin_convenio: true }).select();
      expect(porAdmin.error?.code).toBe(PERMISSION_DENIED);
      expect(await fila(otro.id)).toEqual(otro);
      expect((await service.from("catalogo_items").select("id").eq("sin_convenio", true)).data).toHaveLength(1);
    });

    it("the seed is idempotent: run again, it changes nothing", async () => {
      const antes = await itemNo();
      const { data, error } = await service.rpc("sembrar_convenio_no");
      expect(error).toBeNull();
      expect(data).toBe("existente");
      expect(await itemNo()).toEqual(antes);
      const { data: convenios } = await service.from("catalogo_items").select("id").eq("lista", "convenio").ilike("nombre", "no");
      expect(convenios).toEqual([{ id: antes.id }]);
    });
  });
});
