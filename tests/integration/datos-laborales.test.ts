import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { legajoIdDe } from "./actores";
import { anonClient, createTestUser, deleteTestUsers, serviceClient, type TestUser } from "./helpers";
import { escribirLaboral, itemId, laboralCompleto, laboralDe, type LaboralUpdate } from "./laborales";

// CR-2: group E (datos laborales) in legajos_laborales, from the Configuración
// lists, Admin only. Against the local stack:
// - no API path gives an Empleado a group E value, their own included;
// - list-safe references: an item of another list, or a Puesto of another
//   Área, is refused by the database, and an item in use cannot be deleted;
// - required fields and active items are enforced by the database for any
//   write that sets or changes group E;
// - the free-text values of before map to list items as the migration did.
// The session-bound server client is the signed-in test user's client (as in
// legajos-admin-actions.test.ts), so RLS decides as in the app.
const session = vi.hoisted(() => ({
  client: null as unknown,
  user: null as null | { id: string; email: string; role: "empleado" | "admin"; cuenta: unknown },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));

const { cargarMiLegajo } = await import("@/lib/legajo/mi-legajo");
const configuracion = await import("@/app/(app)/configuracion/actions");

const ACTIVA = { estadoCuenta: "activa", debeCambiarPassword: false };
const PERMISSION_DENIED = "42501";
const FOREIGN_KEY = "23503";
const CHECK_VIOLATION = "23514";
const COLUMNAS_E = [
  "numero_legajo", "area", "area_id", "puesto", "puesto_id", "fecha_ingreso", "estado_laboral", "sede", "sucursal_id",
  "modalidad", "tarea_id", "convenio", "convenio_id", "categoria_id", "bruto_mensual",
];

describe("datos laborales (CR-2)", () => {
  const service = serviceClient();
  let admin: TestUser;
  let empleado: TestUser;
  let otro: TestUser;
  let legajo: string;
  let legajoOtro: string;
  let completo: LaboralUpdate;
  const marca = `CR2 ${randomUUID().slice(0, 8)}`;

  // A fresh item of a list (of an Área, for a Puesto), written with the
  // service role: no history, removed in afterAll.
  async function nuevoItem(lista: "area" | "puesto" | "sucursal" | "tarea", nombre: string, areaId: string | null = null) {
    const { data, error } = await service.from("catalogo_items").insert({ lista, nombre: `${marca} ${nombre}`, area_id: areaId }).select("id, version").single();
    if (error || !data) throw new Error(`item insert failed: ${error?.message}`);
    return data;
  }
  const desactivar = async (id: string) => {
    const { error } = await service.from("catalogo_items").update({ activo: false }).eq("id", id);
    expect(error).toBeNull();
  };

  beforeAll(async () => {
    admin = await createTestUser(service, "laborales-admin", "admin");
    empleado = await createTestUser(service, "laborales-empleado");
    otro = await createTestUser(service, "laborales-otro");
    legajo = await legajoIdDe(service, empleado.id);
    legajoOtro = await legajoIdDe(service, otro.id);
    completo = await laboralCompleto(service, "CR2");
    await escribirLaboral(service, legajo, completo);
    await escribirLaboral(service, legajoOtro, await laboralCompleto(service, "CR2"));
  }, 60_000);

  afterAll(async () => {
    session.client = null;
    session.user = null;
    // The history names the Admin, and the legajos' group E references the
    // test items: both go first.
    await service.from("catalogo_eventos").delete().like("item_nombre", `${marca}%`);
    await deleteTestUsers(service, [admin.id, empleado.id, otro.id]);
    await service.from("catalogo_items").delete().like("nombre", `${marca}%`).eq("lista", "puesto");
    await service.from("catalogo_items").delete().like("nombre", `${marca}%`);
  });

  // -------------------------------------------------------------------------
  describe("an Empleado reads no group E value by any path", () => {
    it("legajos_laborales: neither their own row nor another's, by any filter", async () => {
      for (const consulta of [
        empleado.client.from("legajos_laborales").select("*"),
        empleado.client.from("legajos_laborales").select("*").eq("legajo_id", legajo),
        empleado.client.from("legajos_laborales").select("numero_legajo").eq("legajo_id", legajoOtro),
        empleado.client.from("legajos_laborales").select("legajo_id").eq("numero_legajo", completo.numero_legajo!),
      ]) {
        const { data, error } = await consulta;
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
      // HEAD with a count does not reveal that the row exists either.
      const { count } = await empleado.client.from("legajos_laborales").select("legajo_id", { count: "exact", head: true });
      expect(count).toBe(0);
    });

    it("legajos: the own row has no group E column, and the embed comes back empty", async () => {
      const { data, error } = await empleado.client.from("legajos").select("*").eq("id", legajo).single();
      expect(error).toBeNull();
      for (const columna of COLUMNAS_E) expect(Object.keys(data ?? {}), columna).not.toContain(columna);
      const embebido = await empleado.client.from("legajos").select("id, legajos_laborales(*)").eq("id", legajo).single();
      expect(embebido.error).toBeNull();
      expect(embebido.data?.legajos_laborales).toBeNull();
    });

    it("the Configuración lists are not readable either", async () => {
      const { data, error } = await empleado.client.from("catalogo_items").select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("RPC: the mapping function is service-role only; requests never take group E; no function returns it", async () => {
      for (const cliente of [empleado.client, anonClient()]) {
        const { error } = await cliente.rpc("catalogo_item_por_texto", { p_lista: "area", p_area_id: randomUUID(), p_texto: "Ventas" });
        expect(error?.code).toBe(PERMISSION_DENIED);
      }
      // The functions an Empleado may call return no legajo data: a role, a
      // flag, a document state, a list of allowed fields, a request id.
      expect((await empleado.client.rpc("campos_solicitud_permitidos")).data).not.toEqual(expect.arrayContaining(["numero_legajo"]));
      const solicitud = await empleado.client.rpc("crear_solicitud", {
        p_legajo_id: legajo,
        p_items: [{ campo: "numero_legajo", valor_propuesto: "X" }],
      });
      expect(solicitud.error?.code).toBe(CHECK_VIOLATION);
    });

    it("the Mi Legajo loader (page payload) carries no group E value", async () => {
      session.client = empleado.client;
      session.user = { id: empleado.id, email: empleado.email, role: "empleado", cuenta: ACTIVA };
      const data = await cargarMiLegajo(empleado.id);
      expect(data).not.toBeNull();
      const texto = JSON.stringify(data);
      for (const columna of COLUMNAS_E) expect(Object.keys(data!.legajo), columna).not.toContain(columna);
      for (const valor of [completo.numero_legajo, completo.area_id, completo.puesto_id, completo.sucursal_id, completo.fecha_ingreso]) {
        expect(texto).not.toContain(valor);
      }
    });

    it("an Admin reads it, for any legajo", async () => {
      const { data, error } = await admin.client.from("legajos_laborales").select("numero_legajo").eq("legajo_id", legajo);
      expect(error).toBeNull();
      expect(data).toEqual([{ numero_legajo: completo.numero_legajo }]);
    });
  });

  // -------------------------------------------------------------------------
  describe("list-safe references", () => {
    async function rechazo(cambio: LaboralUpdate, code: string) {
      const antes = await laboralDe(service, legajo);
      const { data, error } = await admin.client.from("legajos_laborales").update(cambio).eq("legajo_id", legajo).select();
      expect(error?.code, JSON.stringify(cambio)).toBe(code);
      expect(data).toBeNull();
      expect(await laboralDe(service, legajo)).toEqual(antes);
    }

    it("refuses an item of another list for every field", async () => {
      const tarea = await itemId(service, "tarea", "Cajero");
      const sucursal = await itemId(service, "sucursal", "Pacheco");
      for (const campo of ["area_id", "sucursal_id", "convenio_id", "categoria_id"] as const) {
        await rechazo({ [campo]: tarea }, FOREIGN_KEY);
      }
      await rechazo({ tarea_id: sucursal }, FOREIGN_KEY);
      await rechazo({ puesto_id: completo.area_id }, FOREIGN_KEY);
    });

    it("refuses a Puesto of another Área, and an Área that leaves the Puesto behind", async () => {
      await rechazo({ puesto_id: await itemId(service, "puesto", "Depósito", "Logística") }, FOREIGN_KEY);
      await rechazo({ area_id: await itemId(service, "area", "Logística") }, FOREIGN_KEY);
      // Both changed together is fine.
      const cambio = {
        area_id: await itemId(service, "area", "Logística"),
        puesto_id: await itemId(service, "puesto", "Depósito", "Logística"),
      };
      const { error } = await admin.client.from("legajos_laborales").update(cambio).eq("legajo_id", legajo);
      expect(error).toBeNull();
      await escribirLaboral(service, legajo, { area_id: completo.area_id, puesto_id: completo.puesto_id });
    });

    it("an item a legajo uses cannot be deleted (PostgREST and the Configuración action); once unused, it can", async () => {
      const tarea = await nuevoItem("tarea", "En uso");
      await escribirLaboral(service, legajoOtro, { tarea_id: tarea.id });

      const directo = await admin.client.from("catalogo_items").delete().eq("id", tarea.id).select("id");
      expect(directo.error?.code).toBe(FOREIGN_KEY);
      session.client = admin.client;
      session.user = { id: admin.id, email: admin.email, role: "admin", cuenta: ACTIVA };
      expect(await configuracion.eliminarItem({ id: tarea.id, version: tarea.version })).toEqual({
        ok: false,
        error: copy.configuracion.errors.enUso,
      });
      expect((await service.from("catalogo_items").select("id").eq("id", tarea.id)).data).toHaveLength(1);

      await escribirLaboral(service, legajoOtro, { tarea_id: null });
      expect(await configuracion.eliminarItem({ id: tarea.id, version: tarea.version })).toEqual({ ok: true });
      expect((await service.from("catalogo_items").select("id").eq("id", tarea.id)).data).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("required fields (legajos_laborales_validar)", () => {
    it("a new account's empty row is allowed; a write that sets part of group E is refused", async () => {
      const nuevo = await createTestUser(service, "laborales-nuevo");
      try {
        const id = await legajoIdDe(service, nuevo.id);
        const vacio = await laboralDe(service, id);
        expect(vacio).toMatchObject({ numero_legajo: null, area_id: null, sucursal_id: null });
        for (const parcial of [
          { numero_legajo: `P-${randomUUID().slice(0, 8)}` },
          { tarea_id: completo.tarea_id },
          { ...completo, numero_legajo: `P-${randomUUID().slice(0, 8)}`, sucursal_id: null },
          { ...completo, numero_legajo: "   " },
        ]) {
          const { data, error } = await admin.client.from("legajos_laborales").update(parcial).eq("legajo_id", id).select();
          expect(error?.code, JSON.stringify(parcial)).toBe(CHECK_VIOLATION);
          expect(error?.hint).toBe("laborales_incompletos");
          expect(data).toBeNull();
        }
        // The service role too.
        const servicio = await service.from("legajos_laborales").update({ estado_laboral: "activo" }).eq("legajo_id", id);
        expect(servicio.error?.hint).toBe("laborales_incompletos");
        expect(await laboralDe(service, id)).toEqual(vacio);

        // Complete: saved.
        const valores = { ...completo, numero_legajo: `P-${randomUUID().slice(0, 8)}` };
        const ok = await admin.client.from("legajos_laborales").update(valores).eq("legajo_id", id).select("numero_legajo");
        expect(ok.error).toBeNull();
        expect(ok.data).toEqual([{ numero_legajo: valores.numero_legajo }]);
      } finally {
        await deleteTestUsers(service, [nuevo.id]);
      }
    });

    it("on a complete row, clearing a required field is refused (Convenio too, CR-5); an optional one may be cleared", async () => {
      const antes = await laboralDe(service, legajo);
      for (const campo of ["numero_legajo", "area_id", "puesto_id", "fecha_ingreso", "estado_laboral", "sucursal_id", "convenio_id"] as const) {
        const { error } = await admin.client.from("legajos_laborales").update({ [campo]: null } as LaboralUpdate).eq("legajo_id", legajo);
        expect(error?.hint, campo).toBe("laborales_incompletos");
      }
      expect(await laboralDe(service, legajo)).toEqual(antes);
      const opcional = await admin.client
        .from("legajos_laborales")
        .update({ tarea_id: null, categoria_id: null })
        .eq("legajo_id", legajo)
        .select("tarea_id, categoria_id");
      expect(opcional.error).toBeNull();
      expect(opcional.data).toEqual([{ tarea_id: null, categoria_id: null }]);
      await escribirLaboral(service, legajo, { tarea_id: completo.tarea_id, categoria_id: completo.categoria_id });
    });
  });

  // -------------------------------------------------------------------------
  describe("active items", () => {
    it("an inactive item cannot be newly chosen; a legajo that has it keeps it through other changes", async () => {
      const sucursal = await nuevoItem("sucursal", "Cerrada");
      await escribirLaboral(service, legajoOtro, { sucursal_id: sucursal.id });
      await desactivar(sucursal.id);

      // Kept: another field changes, the inactive Sucursal stays.
      const otroCambio = await admin.client
        .from("legajos_laborales")
        .update({ numero_legajo: `K-${randomUUID().slice(0, 8)}` })
        .eq("legajo_id", legajoOtro)
        .select("sucursal_id");
      expect(otroCambio.error).toBeNull();
      expect(otroCambio.data).toEqual([{ sucursal_id: sucursal.id }]);

      // Newly chosen elsewhere: refused.
      const antes = await laboralDe(service, legajo);
      const nuevo = await admin.client.from("legajos_laborales").update({ sucursal_id: sucursal.id }).eq("legajo_id", legajo).select();
      expect(nuevo.error?.code).toBe(CHECK_VIOLATION);
      expect(nuevo.error?.hint).toBe("item_inactivo");
      expect(await laboralDe(service, legajo)).toEqual(antes);
      await escribirLaboral(service, legajoOtro, { sucursal_id: completo.sucursal_id });
    });

    it("a Puesto of an inactive Área cannot be newly chosen", async () => {
      const area = await nuevoItem("area", "Área cerrada");
      const puesto = await nuevoItem("puesto", "Puesto", area.id);
      await desactivar(area.id);
      const antes = await laboralDe(service, legajo);
      const { error } = await admin.client.from("legajos_laborales").update({ area_id: area.id, puesto_id: puesto.id }).eq("legajo_id", legajo);
      expect(error?.code).toBe(CHECK_VIOLATION);
      expect(error?.hint).toBe("item_inactivo");
      expect(await laboralDe(service, legajo)).toEqual(antes);
    });
  });

  // -------------------------------------------------------------------------
  // The migration mapped every legajo's Área, Puesto (within the mapped
  // Área), Sede and Convenio through catalogo_item_por_texto. The rows it
  // migrated are gone from this stack (applied before any data), so the
  // function is checked with the inputs the old free text could hold.
  describe("data migration mapping (catalogo_item_por_texto)", () => {
    const mapear = async (lista: "area" | "puesto" | "sucursal" | "convenio", texto: string | null, area: string | null = null) => {
      const { data, error } = await service.rpc("catalogo_item_por_texto", {
        p_lista: lista,
        p_area_id: area as string,
        p_texto: texto as string,
      });
      expect(error).toBeNull();
      return data;
    };

    it("matches trimmed, with repeated spaces, without case or accents", async () => {
      const ventas = await itemId(service, "area", "Ventas");
      const administracion = await itemId(service, "area", "Administración");
      expect(await mapear("area", "  ventas ")).toBe(ventas);
      expect(await mapear("area", "ADMINISTRACION")).toBe(administracion);
      expect(await mapear("sucursal", "san   martin")).toBe(await itemId(service, "sucursal", "San Martín"));
      expect(await mapear("convenio", "comercio")).toBe(await itemId(service, "convenio", "Comercio"));
      expect(await mapear("puesto", "mostrador (sm)", ventas)).toBe(await itemId(service, "puesto", "Mostrador (SM)", "Ventas"));
    });

    it("leaves unmatched values, a Puesto of another Área and empty text as null", async () => {
      expect(await mapear("area", "Operaciones")).toBeNull();
      expect(await mapear("sucursal", "Sede de Prueba")).toBeNull();
      expect(await mapear("puesto", "Mostrador (SM)", await itemId(service, "area", "Logística"))).toBeNull();
      expect(await mapear("puesto", "Mostrador (SM)", null)).toBeNull();
      expect(await mapear("area", "")).toBeNull();
      expect(await mapear("area", null)).toBeNull();
    });
  });
});
