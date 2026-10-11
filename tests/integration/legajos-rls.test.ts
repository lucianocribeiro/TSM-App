import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import {
  anonClient,
  createTestUser,
  deleteTestUsers,
  serviceClient,
  type TestUser,
  type TypedClient,
} from "./helpers";
import { laboralCompleto, laboralDe } from "./laborales";

// RLS, grants, triggers and constraints for public.legajos and public.legajo_hijos.
// Assertions run through user sessions; the service-role client is used for
// setup and for reading back the stored state only.

type LegajoUpdate = Database["public"]["Tables"]["legajos"]["Update"];

const PERMISSION_DENIED = "42501";
const CHECK_VIOLATION = "23514";

const DATA_COLUMNS = [
  "nombres", "apellido", "dni", "nacionalidad", "cuil", "fecha_nacimiento",
  "calle_altura", "piso_depto", "localidad", "partido", "partido_otro", "telefono_celular", "email_personal",
  "estado_civil", "nombre_conyuge", "tiene_hijos",
  "grupo_sanguineo", "alergias", "medicacion_habitual", "obra_social", "numero_afiliado",
  "emergencia_nombre", "emergencia_parentesco", "emergencia_domicilio", "emergencia_telefono",
] as const;

// Group E's former columns (CR-2: now in legajos_laborales, or dropped).
const COLUMNAS_E_ANTERIORES = [
  "numero_legajo", "area", "puesto", "fecha_ingreso", "estado_laboral", "sede", "modalidad", "convenio", "bruto_mensual",
] as const;

// Group A to D values. Since F1-06B only Admin writes them directly; an
// Empleado submits them as a change request (aprobaciones-rls.test.ts).
const PERSONAL_UPDATE: LegajoUpdate = {
  nombres: "Prueba RLS",
  apellido: "Ficticio",
  dni: "91000001",
  nacionalidad: "Argentina",
  cuil: "20-91000001-3",
  fecha_nacimiento: "1991-01-01",
  calle_altura: "Calle de Prueba 1",
  piso_depto: "PB",
  localidad: "Localidad de Prueba",
  partido: "Otro",
  partido_otro: "Partido de Prueba",
  telefono_celular: "1100009999",
  email_personal: "rls.personal@example.test",
  estado_civil: "casado",
  nombre_conyuge: "Cónyuge de Prueba",
  tiene_hijos: true,
  grupo_sanguineo: "AB+",
  alergias: "Ninguna",
  medicacion_habitual: "Ninguna",
  obra_social: "Obra Social de Prueba",
  numero_afiliado: "RLS-0001",
  emergencia_nombre: "Contacto de Prueba",
  emergencia_parentesco: "Madre",
  emergencia_domicilio: "Calle de Prueba 2",
  emergencia_telefono: "1100008888",
};

describe("legajos and legajo_hijos RLS", () => {
  const service = serviceClient();
  let empleadoA: TestUser;
  let empleadoB: TestUser;
  let admin: TestUser;
  let legajoA: string;
  let legajoB: string;
  let hijoB: string;
  const createdIds: string[] = [];

  async function legajoIdOf(profileId: string): Promise<string> {
    const { data, error } = await service
      .from("legajos")
      .select("id")
      .eq("profile_id", profileId)
      .single();
    if (error || !data) throw new Error(`legajo lookup failed: ${error?.message}`);
    return data.id;
  }

  async function storedLegajo(id: string) {
    const { data, error } = await service.from("legajos").select("*").eq("id", id).single();
    expect(error).toBeNull();
    return data;
  }

  async function addChild(client: TypedClient, legajoId: string, nombre: string) {
    return client
      .from("legajo_hijos")
      .insert({ legajo_id: legajoId, nombre_completo: nombre, fecha_nacimiento: "2018-05-05" })
      .select();
  }

  beforeAll(async () => {
    empleadoA = await createTestUser(service, "legajo-empleado-a");
    empleadoB = await createTestUser(service, "legajo-empleado-b");
    admin = await createTestUser(service, "legajo-admin", "admin");
    createdIds.push(empleadoA.id, empleadoB.id, admin.id);

    legajoA = await legajoIdOf(empleadoA.id);
    legajoB = await legajoIdOf(empleadoB.id);

    const { data, error } = await service
      .from("legajo_hijos")
      .insert({ legajo_id: legajoB, nombre_completo: "Hijo de B (prueba)", fecha_nacimiento: "2016-06-06" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`child setup failed: ${error?.message}`);
    hijoB = data.id;
  });

  afterAll(async () => {
    await deleteTestUsers(service, createdIds);
  });

  describe("anonymous", () => {
    it("cannot read legajos or legajo_hijos", async () => {
      for (const table of ["legajos", "legajo_hijos"] as const) {
        const { data, error } = await anonClient().from(table).select("*");
        expect(data, table).toBeNull();
        expect(error?.code, table).toBe(PERMISSION_DENIED);
      }
    });

    it("cannot write legajos or legajo_hijos", async () => {
      const update = await anonClient().from("legajos").update({ nombres: "x" }).eq("id", legajoA).select();
      expect(update.error?.code).toBe(PERMISSION_DENIED);

      const insert = await anonClient().from("legajos").insert({ profile_id: empleadoA.id }).select();
      expect(insert.error?.code).toBe(PERMISSION_DENIED);

      const del = await anonClient().from("legajos").delete().eq("id", legajoA).select();
      expect(del.error?.code).toBe(PERMISSION_DENIED);

      const child = await addChild(anonClient(), legajoA, "Anon");
      expect(child.error?.code).toBe(PERMISSION_DENIED);

      const childUpdate = await anonClient().from("legajo_hijos").update({ nombre_completo: "x" }).eq("id", hijoB).select();
      expect(childUpdate.error?.code).toBe(PERMISSION_DENIED);

      const childDelete = await anonClient().from("legajo_hijos").delete().eq("id", hijoB).select();
      expect(childDelete.error?.code).toBe(PERMISSION_DENIED);
    });
  });

  describe("creation trigger", () => {
    it("creates exactly one empty legajo for a new user", async () => {
      const user = await createTestUser(service, "legajo-trigger");
      createdIds.push(user.id);

      const { data, error } = await user.client.from("legajos").select("*");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const legajo = data?.[0];
      expect(legajo?.profile_id).toBe(user.id);
      for (const column of DATA_COLUMNS) {
        expect(legajo?.[column], column).toBeNull();
      }

      const { count } = await service
        .from("legajos")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", user.id);
      expect(count).toBe(1);

      // And its empty group E row (CR-2), which the user cannot read.
      expect(await laboralDe(service, legajo!.id)).toMatchObject({
        numero_legajo: null, area_id: null, puesto_id: null, fecha_ingreso: null, estado_laboral: null,
        sucursal_id: null, tarea_id: null, convenio_id: null, categoria_id: null,
      });
      const propio = await user.client.from("legajos_laborales").select("*");
      expect(propio.error).toBeNull();
      expect(propio.data).toEqual([]);
    });
  });

  describe("empleado reads", () => {
    it("reading all legajos returns only the own row", async () => {
      const { data, error } = await empleadoA.client.from("legajos").select("id, profile_id");
      expect(error).toBeNull();
      expect(data).toEqual([{ id: legajoA, profile_id: empleadoA.id }]);
    });

    it("cannot read another empleado's legajo or children by id", async () => {
      const legajo = await empleadoA.client.from("legajos").select("*").eq("id", legajoB);
      expect(legajo.error).toBeNull();
      expect(legajo.data).toEqual([]);

      const byProfile = await empleadoA.client.from("legajos").select("*").eq("profile_id", empleadoB.id);
      expect(byProfile.data).toEqual([]);

      const children = await empleadoA.client.from("legajo_hijos").select("*").eq("legajo_id", legajoB);
      expect(children.error).toBeNull();
      expect(children.data).toEqual([]);

      const child = await empleadoA.client.from("legajo_hijos").select("*").eq("id", hijoB);
      expect(child.data).toEqual([]);
    });
  });

  describe("empleado writes on legajos", () => {
    // F1-06B: the update policy is Admin only, so no own row is reachable.
    it.each(Object.entries(PERSONAL_UPDATE))(
      "cannot update group A to D column %s on own legajo directly",
      async (column, value) => {
        const before = await storedLegajo(legajoA);
        const { data, error } = await empleadoA.client
          .from("legajos")
          .update({ [column]: value } as LegajoUpdate)
          .eq("id", legajoA)
          .select();
        expect(error).toBeNull();
        expect(data).toEqual([]);
        expect(await storedLegajo(legajoA)).toEqual(before);
      },
    );

    // CR-2: group E left this table; its own (legajos_laborales) is Admin
    // only (datos-laborales.test.ts).
    it("the own legajo row carries no group E column", async () => {
      const { data, error } = await empleadoA.client.from("legajos").select("*").eq("id", legajoA).single();
      expect(error).toBeNull();
      for (const column of COLUMNAS_E_ANTERIORES) expect(Object.keys(data ?? {}), column).not.toContain(column);
      for (const column of COLUMNAS_E_ANTERIORES) {
        const nombrada = await empleadoA.client.from("legajos").select(column).eq("id", legajoA);
        expect(nombrada.error?.code, column).toBe("42703");
      }
    });

    it("cannot update another empleado's legajo", async () => {
      const { data, error } = await empleadoA.client
        .from("legajos")
        .update({ nombres: "Intruso" })
        .eq("id", legajoB)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect((await storedLegajo(legajoB))?.nombres).toBeNull();
    });

    it("cannot change profile_id", async () => {
      const { data, error } = await empleadoA.client
        .from("legajos")
        .update({ profile_id: empleadoB.id })
        .eq("id", legajoA)
        .select();
      expect(data).toBeNull();
      expect(error?.code).toBe(PERMISSION_DENIED);
      expect((await storedLegajo(legajoA))?.profile_id).toBe(empleadoA.id);
    });

    it("cannot insert a legajo", async () => {
      const { data, error } = await empleadoA.client
        .from("legajos")
        .insert({ profile_id: empleadoA.id })
        .select();
      expect(data).toBeNull();
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("cannot delete own or another legajo", async () => {
      for (const id of [legajoA, legajoB]) {
        const { data, error } = await empleadoA.client.from("legajos").delete().eq("id", id).select();
        expect(data).toBeNull();
        expect(error?.code).toBe(PERMISSION_DENIED);
        expect((await storedLegajo(id))?.id).toBe(id);
      }
    });
  });

  describe("empleado children", () => {
    // F1-06B: the children set is approved as one field ("hijos"); direct
    // writes are Admin only. Reading own children is unchanged.
    it("reads own children but cannot add, edit or delete them directly", async () => {
      const { data: own, error: setupError } = await service
        .from("legajo_hijos")
        .insert({ legajo_id: legajoA, nombre_completo: "Hijo Propio (prueba)", fecha_nacimiento: "2018-05-05" })
        .select("id")
        .single();
      if (setupError || !own) throw new Error(`child setup failed: ${setupError?.message}`);
      const childId = own.id;

      const listed = await empleadoA.client.from("legajo_hijos").select("id").eq("legajo_id", legajoA);
      expect(listed.data?.map((row) => row.id)).toContain(childId);

      const added = await addChild(empleadoA.client, legajoA, "Hijo Nuevo (prueba)");
      expect(added.data).toBeNull();
      expect(added.error?.code).toBe(PERMISSION_DENIED);

      const edited = await empleadoA.client
        .from("legajo_hijos")
        .update({ nombre_completo: "Hijo Propio Editado (prueba)", fecha_nacimiento: "2018-06-06" })
        .eq("id", childId)
        .select();
      expect(edited.error).toBeNull();
      expect(edited.data).toEqual([]);

      const deleted = await empleadoA.client.from("legajo_hijos").delete().eq("id", childId).select();
      expect(deleted.error).toBeNull();
      expect(deleted.data).toEqual([]);

      const { data: stored } = await service.from("legajo_hijos").select("nombre_completo, fecha_nacimiento").eq("legajo_id", legajoA);
      expect(stored).toEqual([{ nombre_completo: "Hijo Propio (prueba)", fecha_nacimiento: "2018-05-05" }]);

      await service.from("legajo_hijos").delete().eq("id", childId);
    });

    it("cannot add a child to another empleado's legajo", async () => {
      const { data, error } = await addChild(empleadoA.client, legajoB, "Intruso (prueba)");
      expect(data).toBeNull();
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("cannot edit or delete another empleado's children", async () => {
      const edited = await empleadoA.client
        .from("legajo_hijos")
        .update({ nombre_completo: "Intruso" })
        .eq("id", hijoB)
        .select();
      expect(edited.error).toBeNull();
      expect(edited.data).toEqual([]);

      const deleted = await empleadoA.client.from("legajo_hijos").delete().eq("id", hijoB).select();
      expect(deleted.error).toBeNull();
      expect(deleted.data).toEqual([]);

      const { data } = await service.from("legajo_hijos").select("nombre_completo").eq("id", hijoB).single();
      expect(data?.nombre_completo).toBe("Hijo de B (prueba)");
    });

    it("cannot move own child to another empleado's legajo", async () => {
      const added = await addChild(service, legajoA, "Hijo a mover (prueba)");
      const childId = added.data?.[0]?.id as string;
      expect(childId).toBeDefined();

      // F1-06B: no own child is reachable for update, so nothing moves.
      const { data, error } = await empleadoA.client
        .from("legajo_hijos")
        .update({ legajo_id: legajoB })
        .eq("id", childId)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const stored = await service.from("legajo_hijos").select("legajo_id").eq("id", childId).single();
      expect(stored.data?.legajo_id).toBe(legajoA);
      await service.from("legajo_hijos").delete().eq("id", childId);
    });
  });

  describe("admin", () => {
    it("reads all legajos and children", async () => {
      const legajos = await admin.client.from("legajos").select("id");
      expect(legajos.error).toBeNull();
      expect(legajos.data?.map((row) => row.id)).toEqual(expect.arrayContaining([legajoA, legajoB]));

      const children = await admin.client.from("legajo_hijos").select("id").eq("id", hijoB);
      expect(children.data).toEqual([{ id: hijoB }]);
    });

    it("updates groups A to D, and group E in its own table, on any legajo", async () => {
      const update = { ...PERSONAL_UPDATE, dni: "92000002", tiene_hijos: false };
      const { data, error } = await admin.client.from("legajos").update(update).eq("id", legajoB).select();
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(await storedLegajo(legajoB)).toMatchObject(update);

      const laboral = await laboralCompleto(service, "RLS-E-ADMIN");
      const e = await admin.client.from("legajos_laborales").update(laboral).eq("legajo_id", legajoB).select();
      expect(e.error).toBeNull();
      expect(e.data).toHaveLength(1);
      expect(await laboralDe(service, legajoB)).toMatchObject(laboral);
    });

    it("manages any employee's children", async () => {
      const added = await addChild(admin.client, legajoB, "Hijo cargado por Admin (prueba)");
      expect(added.error).toBeNull();
      const childId = added.data?.[0]?.id as string;

      const edited = await admin.client
        .from("legajo_hijos")
        .update({ nombre_completo: "Editado por Admin (prueba)" })
        .eq("id", childId)
        .select();
      expect(edited.error).toBeNull();
      expect(edited.data).toHaveLength(1);

      const deleted = await admin.client.from("legajo_hijos").delete().eq("id", childId).select();
      expect(deleted.error).toBeNull();
      expect(deleted.data).toHaveLength(1);
    });
  });

  describe("check constraints", () => {
    // Through the Admin session, the only role that updates legajos directly
    // since F1-06B (it was the Empleado session before).
    async function expectCheckViolation(update: LegajoUpdate) {
      const { data, error } = await admin.client.from("legajos").update(update).eq("id", legajoA).select();
      expect(data).toBeNull();
      expect(error?.code).toBe(CHECK_VIOLATION);
    }

    it("rejects a DNI with non-digits", async () => {
      await expectCheckViolation({ dni: "30.000.000" });
      await expectCheckViolation({ dni: "30A00000" });
    });

    it("rejects partido Otro without partido_otro", async () => {
      await expectCheckViolation({ partido: "Otro", partido_otro: null });
      await expectCheckViolation({ partido: "Otro", partido_otro: "  " });
    });

    it("rejects a whitespace-only partido_otro", async () => {
      await expectCheckViolation({ partido: "Otro", partido_otro: "\t" });
      await expectCheckViolation({ partido: "Otro", partido_otro: "\n" });
      await expectCheckViolation({ partido: "Otro", partido_otro: " \t\n " });
    });

    it("rejects partido_otro with another partido", async () => {
      await expectCheckViolation({ partido: "Tigre", partido_otro: "Algo" });
    });

    it("rejects a partido outside the PRD list", async () => {
      await expectCheckViolation({ partido: "Rosario", partido_otro: null });
    });
  });
});
