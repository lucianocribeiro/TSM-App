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
  "numero_legajo", "area", "puesto", "fecha_ingreso", "estado_laboral", "sede", "modalidad", "convenio", "bruto_mensual",
] as const;

// Group A to D values an Empleado may write on their own legajo.
const PERSONAL_UPDATE: LegajoUpdate = {
  nombres: "Prueba RLS",
  apellido: "Ficticio",
  dni: "91000001",
  nacionalidad: "Argentina",
  cuil: "20910000011",
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

// One value per group E column, different from the empty legajo (all null).
const LABORAL_VALUES: LegajoUpdate = {
  numero_legajo: "RLS-E-001",
  area: "Área de Prueba",
  puesto: "Puesto de Prueba",
  fecha_ingreso: "2020-01-02",
  estado_laboral: "activo",
  sede: "Sede de Prueba",
  modalidad: "Presencial",
  convenio: "Convenio de Prueba",
  bruto_mensual: 123456.78,
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
    it("updates own groups A to D", async () => {
      const { data, error } = await empleadoA.client
        .from("legajos")
        .update(PERSONAL_UPDATE)
        .eq("id", legajoA)
        .select();
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(await storedLegajo(legajoA)).toMatchObject(PERSONAL_UPDATE);
    });

    it.each(Object.entries(LABORAL_VALUES))("cannot change group E column %s on own legajo", async (column, value) => {
      const before = await storedLegajo(legajoA);
      const { data, error } = await empleadoA.client
        .from("legajos")
        .update({ [column]: value } as LegajoUpdate)
        .eq("id", legajoA)
        .select();
      expect(data).toBeNull();
      expect(error?.code).toBe(PERMISSION_DENIED);
      const after = await storedLegajo(legajoA);
      expect(after?.[column as keyof typeof after]).toEqual(before?.[column as keyof typeof before]);
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
    it("adds, edits and deletes own children", async () => {
      const added = await addChild(empleadoA.client, legajoA, "Hijo Propio (prueba)");
      expect(added.error).toBeNull();
      expect(added.data).toHaveLength(1);
      const childId = added.data?.[0]?.id as string;

      const edited = await empleadoA.client
        .from("legajo_hijos")
        .update({ nombre_completo: "Hijo Propio Editado (prueba)", fecha_nacimiento: "2018-06-06" })
        .eq("id", childId)
        .select();
      expect(edited.error).toBeNull();
      expect(edited.data?.[0]).toMatchObject({ nombre_completo: "Hijo Propio Editado (prueba)", fecha_nacimiento: "2018-06-06" });

      const listed = await empleadoA.client.from("legajo_hijos").select("id").eq("legajo_id", legajoA);
      expect(listed.data?.map((row) => row.id)).toContain(childId);

      const deleted = await empleadoA.client.from("legajo_hijos").delete().eq("id", childId).select();
      expect(deleted.error).toBeNull();
      expect(deleted.data).toHaveLength(1);

      const { count } = await service.from("legajo_hijos").select("id", { count: "exact", head: true }).eq("id", childId);
      expect(count).toBe(0);
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
      const added = await addChild(empleadoA.client, legajoA, "Hijo a mover (prueba)");
      const childId = added.data?.[0]?.id as string;
      expect(childId).toBeDefined();

      const { data, error } = await empleadoA.client
        .from("legajo_hijos")
        .update({ legajo_id: legajoB })
        .eq("id", childId)
        .select();
      expect(data).toBeNull();
      expect(error?.code).toBe(PERMISSION_DENIED);

      const stored = await service.from("legajo_hijos").select("legajo_id").eq("id", childId).single();
      expect(stored.data?.legajo_id).toBe(legajoA);
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

    it("updates groups A to E on any legajo", async () => {
      const update = { ...PERSONAL_UPDATE, dni: "92000002", tiene_hijos: false, ...LABORAL_VALUES, numero_legajo: "RLS-E-ADMIN" };
      const { data, error } = await admin.client.from("legajos").update(update).eq("id", legajoB).select();
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(await storedLegajo(legajoB)).toMatchObject(update);
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
    async function expectCheckViolation(update: LegajoUpdate) {
      const { data, error } = await empleadoA.client.from("legajos").update(update).eq("id", legajoA).select();
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

    it("rejects a negative bruto_mensual", async () => {
      const { data, error } = await admin.client
        .from("legajos")
        .update({ bruto_mensual: -1 })
        .eq("id", legajoB)
        .select();
      expect(data).toBeNull();
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("rejects NaN in bruto_mensual on update and on insert", async () => {
      // PostgREST casts the string "NaN" to numeric NaN.
      const update = await admin.client
        .from("legajos")
        .update({ bruto_mensual: "NaN" as unknown as number })
        .eq("id", legajoB)
        .select();
      expect(update.data).toBeNull();
      expect(update.error?.code).toBe(CHECK_VIOLATION);

      // Insert path: remove the trigger-created legajo first, so the only
      // reason this insert can fail is the constraint.
      const user = await createTestUser(service, "legajo-nan");
      createdIds.push(user.id);
      const removed = await service.from("legajos").delete().eq("profile_id", user.id).select();
      expect(removed.error).toBeNull();
      expect(removed.data).toHaveLength(1);

      const insert = await admin.client
        .from("legajos")
        .insert({ profile_id: user.id, bruto_mensual: "NaN" as unknown as number })
        .select();
      expect(insert.data).toBeNull();
      expect(insert.error?.code).toBe(CHECK_VIOLATION);
    });
  });
});
