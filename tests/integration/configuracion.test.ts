import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import type { Database } from "@/lib/supabase/database.types";
import { createTestUser, deleteTestUsers, serviceClient, type TestUser, type TypedClient } from "./helpers";

// CR-1, Configuración (PRD "Configuración"): the lists' database rules and
// the Server Actions as an active Admin, against the local stack. Access per
// role and account state is in the access matrix (matriz-acceso.ts) and the
// action boundary matrix (acciones-frontera.test.ts).
//
// Every item created here carries MARCA, and items that are moved live under
// an Área created here, so the seeded lists keep their order.

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

const acciones = await import("@/app/(app)/configuracion/actions");

type Lista = Database["public"]["Enums"]["catalogo_lista"];

const errors = copy.configuracion.errors;
const fallo = (error: string) => ({ ok: false, error });
const MARCA = `Config ${randomUUID().slice(0, 8)}`;

describe("Configuración lists", () => {
  const service = serviceClient();
  let admin: TestUser;
  let otroAdmin: TestUser;

  beforeAll(async () => {
    admin = await createTestUser(service, "config-admin", "admin");
    otroAdmin = await createTestUser(service, "config-otro-admin", "admin");
    session.client = admin.client;
  }, 60_000);

  afterAll(async () => {
    session.client = null;
    await service.from("catalogo_eventos").delete().in("actor_id", [admin.id, otroAdmin.id]);
    // Puestos first: an Área with Puestos cannot be deleted.
    await service.from("catalogo_items").delete().eq("lista", "puesto").like("nombre", `${MARCA}%`);
    const { data: areas } = await service.from("catalogo_items").select("id").eq("lista", "area").like("nombre", `${MARCA}%`);
    const areaIds = (areas ?? []).map((area) => area.id);
    await service.from("catalogo_items").delete().in("area_id", areaIds);
    await service.from("catalogo_items").delete().like("nombre", `${MARCA}%`);
    await deleteTestUsers(service, [admin.id, otroAdmin.id]);
  });

  async function item(id: string) {
    const { data } = await service.from("catalogo_items").select("*").eq("id", id).single();
    return data!;
  }

  async function porNombre(lista: Lista, nombre: string, areaId: string | null = null) {
    let consulta = service.from("catalogo_items").select("*").eq("lista", lista).eq("nombre", nombre);
    consulta = areaId ? consulta.eq("area_id", areaId) : consulta.is("area_id", null);
    const { data } = await consulta.single();
    return data!;
  }

  // An Área of this run, as the Admin.
  async function nuevaArea(sufijo: string) {
    const nombre = `${MARCA} ${sufijo}`;
    expect(await acciones.agregarItem({ lista: "area", nombre })).toEqual({ ok: true });
    return porNombre("area", nombre);
  }

  async function grupo(lista: Lista, areaId: string | null) {
    let consulta = service.from("catalogo_items").select("nombre, posicion, activo").eq("lista", lista);
    consulta = areaId ? consulta.eq("area_id", areaId) : consulta.is("area_id", null);
    const { data } = await consulta.order("posicion");
    return data ?? [];
  }

  async function eventos(itemId: string) {
    const { data } = await service
      .from("catalogo_eventos")
      .select("accion, valor_anterior, valor_nuevo, actor_id, item_nombre, area_nombre, lista")
      .eq("item_id", itemId)
      .order("secuencia");
    return data ?? [];
  }

  describe("initial values", () => {
    const SEMILLA: Record<Exclude<Lista, "puesto">, string[]> = {
      area: ["Ventas", "Administración", "Logística", "Gerencia"],
      sucursal: ["Casa Central", "San Martín", "Pacheco", "San Justo"],
      convenio: ["Comercio"],
      tarea: ["Administrativo", "Ventas", "Maestranza y Servicios", "Cajero"],
      categoria: ["A", "B", "C", "D", "E", "F"],
    };
    const PUESTOS: Record<string, string[]> = {
      Ventas: ["Cuentas corrientes", "Mostrador (SM)", "Mostrador (PA)", "Mostrador (SJ)"],
      Administración: ["Cobranzas", "Proveedores", "Otros"],
      Logística: ["Depósito", "Distribución"],
      Gerencia: ["Gerencia"],
    };

    it("every list has its seeded items, active, in order", async () => {
      for (const [lista, nombres] of Object.entries(SEMILLA) as [Lista, string[]][]) {
        const filas = (await grupo(lista, null)).filter((fila) => nombres.includes(fila.nombre));
        expect(filas.map((fila) => fila.nombre), lista).toEqual(nombres);
        expect(filas.every((fila) => fila.activo), lista).toBe(true);
      }
    });

    it("every seeded Área has its Puestos, in order", async () => {
      for (const [area, puestos] of Object.entries(PUESTOS)) {
        const fila = await porNombre("area", area);
        const filas = (await grupo("puesto", fila.id)).filter((puesto) => puestos.includes(puesto.nombre));
        expect(filas.map((puesto) => puesto.nombre), area).toEqual(puestos);
      }
    });

    it("the seed recorded no history (no user was signed in)", async () => {
      const ventas = await porNombre("area", "Ventas");
      expect(await eventos(ventas.id)).toEqual([]);
    });
  });

  describe("names", () => {
    it("are unique per list ignoring case, accents and spaces, through the action and in the database", async () => {
      const base = `${MARCA} Válida`;
      expect(await acciones.agregarItem({ lista: "sucursal", nombre: `  ${MARCA}   Válida ` })).toEqual({ ok: true });
      expect((await porNombre("sucursal", base)).nombre).toBe(base);

      for (const variante of [base.toUpperCase(), `${MARCA} valida`, `  ${MARCA}  VALIDA  `]) {
        expect(await acciones.agregarItem({ lista: "sucursal", nombre: variante }), variante).toEqual(fallo(errors.nombreDuplicado));
      }
      // The database alone: a normalized variant hits the unique key, an
      // unnormalized one the format check.
      const directo = await admin.client.from("catalogo_items").insert({ lista: "sucursal", nombre: `${MARCA} VALIDA` }).select("id");
      expect(directo.error?.code).toBe("23505");
      const sinNormalizar = await admin.client.from("catalogo_items").insert({ lista: "sucursal", nombre: ` ${MARCA} Otra` }).select("id");
      expect(sinNormalizar.error?.code).toBe("23514");
      // The same name in another list is fine.
      expect(await acciones.agregarItem({ lista: "convenio", nombre: base })).toEqual({ ok: true });
    });

    it("refuses an empty or too long name", async () => {
      expect(await acciones.agregarItem({ lista: "tarea", nombre: "   " })).toEqual(fallo(errors.nombreVacio));
      expect(await acciones.agregarItem({ lista: "tarea", nombre: `${MARCA} ${"x".repeat(60)}` })).toEqual(fallo(errors.nombreLargo));
      const largo = await admin.client.from("catalogo_items").insert({ lista: "tarea", nombre: `${MARCA} ${"x".repeat(60)}` }).select("id");
      expect(largo.error?.code).toBe("23514");
    });

    it("a Puesto is unique within its Área; the same name is allowed in another Área", async () => {
      const norte = await nuevaArea("Norte");
      const sur = await nuevaArea("Sur");
      const nombre = `${MARCA} Encargado`;
      expect(await acciones.agregarItem({ lista: "puesto", areaId: norte.id, nombre })).toEqual({ ok: true });
      expect(await acciones.agregarItem({ lista: "puesto", areaId: sur.id, nombre })).toEqual({ ok: true });
      expect(await acciones.agregarItem({ lista: "puesto", areaId: norte.id, nombre: nombre.toUpperCase() })).toEqual(
        fallo(errors.nombreDuplicadoPuesto),
      );
      const directo = await admin.client.from("catalogo_items").insert({ lista: "puesto", area_id: norte.id, nombre: nombre.toLowerCase() }).select("id");
      expect(directo.error?.code).toBe("23505");
    });

    it("a Puesto needs an Área, and only a Puesto has one", async () => {
      const area = await nuevaArea("Solo puestos");
      expect(await acciones.agregarItem({ lista: "puesto", nombre: `${MARCA} Sin área` })).toEqual(fallo(errors.areaInvalida));
      expect(await acciones.agregarItem({ lista: "puesto", areaId: randomUUID(), nombre: `${MARCA} Área inexistente` })).toEqual(
        fallo(errors.areaInvalida),
      );
      const sucursal = await porNombre("sucursal", "Casa Central");
      expect(await acciones.agregarItem({ lista: "puesto", areaId: sucursal.id, nombre: `${MARCA} Área falsa` })).toEqual(
        fallo(errors.areaInvalida),
      );
      expect(await acciones.agregarItem({ lista: "tarea", areaId: area.id, nombre: `${MARCA} Con área` })).toEqual(fallo(errors.accionFallo));
      // The database alone: a Puesto under a non-Área (composite key), and an Área on another list (check).
      const falso = await admin.client.from("catalogo_items").insert({ lista: "puesto", area_id: sucursal.id, nombre: `${MARCA} Falso` }).select("id");
      expect(falso.error?.code).toBe("23503");
      const conArea = await admin.client.from("catalogo_items").insert({ lista: "tarea", area_id: area.id, nombre: `${MARCA} Falso` }).select("id");
      expect(conArea.error?.code).toBe("23514");
    });
  });

  describe("every change, through the actions, and its history", () => {
    it("records add, rename, reorder, deactivate, reactivate and delete with the user and the values", async () => {
      const area = await nuevaArea("Historia");
      const a = `${MARCA} Primero`;
      const b = `${MARCA} Segundo`;
      expect(await acciones.agregarItem({ lista: "puesto", areaId: area.id, nombre: a })).toEqual({ ok: true });
      expect(await acciones.agregarItem({ lista: "puesto", areaId: area.id, nombre: b })).toEqual({ ok: true });
      const primero = await porNombre("puesto", a, area.id);
      const segundo = await porNombre("puesto", b, area.id);
      // New items go to the end.
      expect(segundo.posicion).toBe(primero.posicion + 1);

      const renombrado = `${MARCA} Renombrado`;
      expect(await acciones.renombrarItem({ id: segundo.id, version: segundo.version, nombre: renombrado })).toEqual({ ok: true });
      const tras = await item(segundo.id);
      expect(tras.nombre).toBe(renombrado);
      expect(tras.version).toBe(segundo.version + 1);

      expect(await acciones.moverItem({ id: segundo.id, version: tras.version, direccion: "arriba" })).toEqual({ ok: true });
      expect((await grupo("puesto", area.id)).map((fila) => fila.nombre)).toEqual([renombrado, a]);

      const movido = await item(segundo.id);
      expect(await acciones.desactivarItem({ id: segundo.id, version: movido.version })).toEqual({ ok: true });
      const inactivo = await item(segundo.id);
      expect(inactivo.activo).toBe(false);
      expect(await acciones.reactivarItem({ id: segundo.id, version: inactivo.version })).toEqual({ ok: true });
      const activo = await item(segundo.id);
      expect(await acciones.eliminarItem({ id: segundo.id, version: activo.version })).toEqual({ ok: true });
      expect((await service.from("catalogo_items").select("id").eq("id", segundo.id)).data).toEqual([]);

      const comun = { actor_id: admin.id, lista: "puesto", area_nombre: area.nombre };
      expect(await eventos(segundo.id)).toEqual([
        { ...comun, accion: "alta", valor_anterior: null, valor_nuevo: b, item_nombre: b },
        { ...comun, accion: "renombre", valor_anterior: b, valor_nuevo: renombrado, item_nombre: renombrado },
        { ...comun, accion: "reorden", valor_anterior: String(segundo.posicion), valor_nuevo: String(primero.posicion), item_nombre: renombrado },
        { ...comun, accion: "desactivacion", valor_anterior: "activo", valor_nuevo: "inactivo", item_nombre: renombrado },
        { ...comun, accion: "reactivacion", valor_anterior: "inactivo", valor_nuevo: "activo", item_nombre: renombrado },
        { ...comun, accion: "baja", valor_anterior: renombrado, valor_nuevo: null, item_nombre: renombrado },
      ]);
      // The neighbour's position change is recorded too.
      expect((await eventos(primero.id)).map((evento) => evento.accion)).toEqual(["alta", "reorden"]);

      // Another Admin's change names that Admin.
      session.client = otroAdmin.client;
      try {
        const actual = await item(primero.id);
        expect(await acciones.renombrarItem({ id: primero.id, version: actual.version, nombre: `${MARCA} Otro` })).toEqual({ ok: true });
      } finally {
        session.client = admin.client;
      }
      expect((await eventos(primero.id)).at(-1)).toMatchObject({ accion: "renombre", actor_id: otroAdmin.id });
    });

    it("an unchanged name or state writes nothing", async () => {
      const nombre = `${MARCA} Igual`;
      expect(await acciones.agregarItem({ lista: "categoria", nombre })).toEqual({ ok: true });
      const fila = await porNombre("categoria", nombre);
      expect(await acciones.renombrarItem({ id: fila.id, version: fila.version, nombre: `  ${nombre} ` })).toEqual({ ok: true });
      expect(await item(fila.id)).toEqual(fila);
      expect((await eventos(fila.id)).map((evento) => evento.accion)).toEqual(["alta"]);
    });

    it("clients cannot write or alter the history, not even an Admin", async () => {
      const area = await nuevaArea("Intocable");
      const antes = await eventos(area.id);
      expect(antes).toHaveLength(1);
      const { data: fila } = await service.from("catalogo_eventos").select("id").eq("item_id", area.id).single();
      const c = admin.client;
      const intentos = await Promise.all([
        c.from("catalogo_eventos").insert({ item_id: area.id, lista: "area", item_nombre: "x", accion: "baja", actor_id: admin.id }).select("id"),
        c.from("catalogo_eventos").update({ valor_nuevo: "x" }).eq("id", fila!.id).select("id"),
        c.from("catalogo_eventos").delete().eq("id", fila!.id).select("id"),
      ]);
      for (const intento of intentos) expect(intento.error?.code).toBe("42501");
      expect(await eventos(area.id)).toEqual(antes);
      // Only the trigger function writes it, and the API roles cannot call it.
      expect((await c.rpc("registrar_catalogo_evento" as never)).error).not.toBeNull();
    });
  });

  describe("rules", () => {
    it("deactivating an Área leaves its Puestos' own state as it was", async () => {
      const area = await nuevaArea("Inactiva");
      expect(await acciones.agregarItem({ lista: "puesto", areaId: area.id, nombre: `${MARCA} Activo` })).toEqual({ ok: true });
      expect(await acciones.desactivarItem({ id: area.id, version: area.version })).toEqual({ ok: true });
      const puesto = await porNombre("puesto", `${MARCA} Activo`, area.id);
      expect(puesto.activo).toBe(true);
      expect((await item(area.id)).activo).toBe(false);
    });

    it("an item in use cannot be deleted (an Área with Puestos); an unused one can", async () => {
      const area = await nuevaArea("En uso");
      expect(await acciones.agregarItem({ lista: "puesto", areaId: area.id, nombre: `${MARCA} Hijo` })).toEqual({ ok: true });
      expect(await acciones.eliminarItem({ id: area.id, version: area.version })).toEqual(fallo(errors.enUso));
      expect((await item(area.id)).nombre).toBe(area.nombre);
      const puesto = await porNombre("puesto", `${MARCA} Hijo`, area.id);
      expect(await acciones.eliminarItem({ id: puesto.id, version: puesto.version })).toEqual({ ok: true });
      expect(await acciones.eliminarItem({ id: area.id, version: area.version })).toEqual({ ok: true });
    });

    it("a stale version is refused as a concurrent change, a missing item as gone", async () => {
      const area = await nuevaArea("Versiones");
      expect(await acciones.renombrarItem({ id: area.id, version: area.version, nombre: `${MARCA} Versiones 2` })).toEqual({ ok: true });
      for (const resultado of [
        await acciones.renombrarItem({ id: area.id, version: area.version, nombre: `${MARCA} Versiones 3` }),
        await acciones.desactivarItem({ id: area.id, version: area.version }),
        await acciones.reactivarItem({ id: area.id, version: area.version }),
        await acciones.moverItem({ id: area.id, version: area.version, direccion: "arriba" }),
        await acciones.eliminarItem({ id: area.id, version: area.version }),
      ]) {
        expect(resultado).toEqual(fallo(errors.cambioConcurrente));
      }
      expect((await item(area.id)).nombre).toBe(`${MARCA} Versiones 2`);
      const ausente = randomUUID();
      expect(await acciones.renombrarItem({ id: ausente, version: 1, nombre: "x" })).toEqual(fallo(errors.noEncontrado));
      expect(await acciones.eliminarItem({ id: ausente, version: 1 })).toEqual(fallo(errors.noEncontrado));
      expect(await acciones.moverItem({ id: ausente, version: 1, direccion: "abajo" })).toEqual(fallo(errors.noEncontrado));
    });

    it("moving past an end is refused", async () => {
      const area = await nuevaArea("Extremos");
      expect(await acciones.agregarItem({ lista: "puesto", areaId: area.id, nombre: `${MARCA} Único` })).toEqual({ ok: true });
      const unico = await porNombre("puesto", `${MARCA} Único`, area.id);
      expect(await acciones.moverItem({ id: unico.id, version: unico.version, direccion: "arriba" })).toEqual(fallo(errors.extremo));
      expect(await acciones.moverItem({ id: unico.id, version: unico.version, direccion: "abajo" })).toEqual(fallo(errors.extremo));
      expect(await item(unico.id)).toEqual(unico);
    });

    it("concurrent additions and moves keep positions unique and nothing is lost", async () => {
      const area = await nuevaArea("Concurrencia");
      const nombres = Array.from({ length: 6 }, (_, i) => `${MARCA} C${i}`);
      const clientes: TypedClient[] = [admin.client, otroAdmin.client];
      const altas = await Promise.all(
        nombres.map((nombre, i) => clientes[i % 2].from("catalogo_items").insert({ lista: "puesto", area_id: area.id, nombre }).select("id")),
      );
      for (const alta of altas) expect(alta.error).toBeNull();
      const despues = await grupo("puesto", area.id);
      expect(despues.map((fila) => fila.posicion)).toEqual([1, 2, 3, 4, 5, 6]);
      expect([...despues.map((fila) => fila.nombre)].sort()).toEqual([...nombres].sort());

      // Two Admins move the same item from the same screen: one wins, the
      // other is refused as stale; positions stay a permutation.
      const ultimo = await porNombre("puesto", despues[5].nombre, area.id);
      const movidas = await Promise.all(
        clientes.map((c) => c.rpc("mover_catalogo_item", { p_item_id: ultimo.id, p_version: ultimo.version, p_direccion: "arriba" })),
      );
      expect(movidas.filter((movida) => movida.error === null)).toHaveLength(1);
      expect(movidas.find((movida) => movida.error)?.error).toMatchObject({ code: "55000", hint: "version" });
      const final = await grupo("puesto", area.id);
      expect(final.map((fila) => fila.posicion)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(final[4].nombre).toBe(ultimo.nombre);

      // Moves of different items at once, in both directions.
      const filas = await Promise.all(final.map((fila) => porNombre("puesto", fila.nombre, area.id)));
      const resultados = await Promise.all(
        filas.map((fila, i) =>
          clientes[i % 2].rpc("mover_catalogo_item", { p_item_id: fila.id, p_version: fila.version, p_direccion: i % 2 ? "arriba" : "abajo" }),
        ),
      );
      for (const resultado of resultados) {
        if (resultado.error) expect(resultado.error.code).toBe("55000");
      }
      expect((await grupo("puesto", area.id)).map((fila) => fila.posicion)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("an Admin named in the lists' history cannot be purged", async () => {
      const { error } = await otroAdmin.client.rpc("purgar_cuenta", { p_profile_id: admin.id, p_email_confirmacion: admin.email });
      expect(error).toMatchObject({ code: "55000", hint: "historial_otras_cuentas" });
      expect((await service.from("profiles").select("id").eq("id", admin.id)).data).toEqual([{ id: admin.id }]);
    });
  });
});
