import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CAMPO_SOLICITUD_CODES } from "@/lib/aprobaciones/campos";
import { parseHijosValor, serializeHijos, SOLICITUD_PENDIENTE_INDEX, DOCUMENTO_PENDIENTE_INDEX } from "@/lib/aprobaciones/solicitudes";
import { buildDocumentoPath } from "@/lib/documentos/paths";
import type { DocumentoTipo } from "@/lib/documentos/tipos";
import type { Database } from "@/lib/supabase/database.types";
import {
  anonClient,
  createTestUser,
  deleteTestUsers,
  serviceClient,
  type TestUser,
  type TypedClient,
} from "./helpers";

// F1-06B: change requests, document review and the decision functions
// (Constitution §9, PRD US-7). Assertions run through user sessions; the
// service-role client is used for setup and for reading back stored state only.

type LegajoUpdate = Database["public"]["Tables"]["legajos"]["Update"];

const PERMISSION_DENIED = "42501";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const INVALID_PARAMETER = "22023";
const NOT_PENDING = "55000";
const NOT_FOUND = "P0002";

const PERSONAL: LegajoUpdate = {
  nombres: "Prueba Aprobación",
  apellido: "Ficticio",
  dni: "93000001",
  fecha_nacimiento: "1990-01-01",
  piso_depto: "2° A",
  partido: "Tigre",
  partido_otro: null,
  estado_civil: "soltero",
  tiene_hijos: true,
  alergias: "Ninguna",
};

const LABORAL: LegajoUpdate = {
  numero_legajo: "APR-E-001",
  area: "Área de Prueba",
  puesto: "Puesto de Prueba",
  fecha_ingreso: "2020-01-02",
  estado_laboral: "activo",
  sede: "Sede de Prueba",
  modalidad: "Presencial",
  convenio: "Convenio de Prueba",
  bruto_mensual: 500000,
};

const HIJOS_INICIALES = [
  { nombre_completo: "Hijo Inicial Uno (prueba)", fecha_nacimiento: "2014-03-03" },
  { nombre_completo: "Hijo Inicial Dos (prueba)", fecha_nacimiento: "2017-07-07" },
];

type ItemInput = { campo: string; valor_propuesto: string | null };

describe("change requests and document approval", () => {
  const service = serviceClient();
  let empleadoA: TestUser;
  let empleadoB: TestUser;
  let admin: TestUser;
  // A second Admin, to tell who reviewed or replaced a document.
  let admin2: TestUser;
  let legajoA: string;
  let legajoB: string;
  // Deleted in order: employees before the admin who reviewed their items.
  const employeeIds: string[] = [];

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
    if (!data) throw new Error("legajo not found");
    return data;
  }

  async function storedHijos(legajoId: string) {
    const { data, error } = await service
      .from("legajo_hijos")
      .select("nombre_completo, fecha_nacimiento")
      .eq("legajo_id", legajoId)
      .order("fecha_nacimiento");
    expect(error).toBeNull();
    return data ?? [];
  }

  async function storedSolicitud(id: string) {
    const { data, error } = await service.from("solicitudes_cambio").select("*").eq("id", id).single();
    expect(error).toBeNull();
    if (!data) throw new Error("request not found");
    return data;
  }

  // crear_solicitud through the given session. Fails the test on error.
  async function crearSolicitud(client: TypedClient, legajoId: string, items: ItemInput[]): Promise<string> {
    const { data, error } = await client.rpc("crear_solicitud", { p_legajo_id: legajoId, p_items: items });
    expect(error).toBeNull();
    expect(typeof data).toBe("string");
    return data ?? "";
  }

  async function solicitudesDe(legajoId: string) {
    const { data, error } = await service.from("solicitudes_cambio").select("id, estado").eq("legajo_id", legajoId);
    expect(error).toBeNull();
    return data ?? [];
  }

  // A request created with the service role (setup for another employee).
  async function solicitudDeServicio(legajoId: string, solicitadoPor: string, campo = "alergias"): Promise<string> {
    const { data, error } = await service
      .from("solicitudes_cambio")
      .insert({ legajo_id: legajoId, solicitado_por: solicitadoPor })
      .select("id")
      .single();
    if (error || !data) throw new Error(`request setup failed: ${error?.message}`);
    const item = await service
      .from("solicitudes_cambio_items")
      .insert({ solicitud_id: data.id, campo, valor_propuesto: "Dato de servicio (prueba)" });
    if (item.error) throw new Error(`item setup failed: ${item.error.message}`);
    return data.id;
  }

  function docPath(profileId: string, tipo: DocumentoTipo): string {
    const path = buildDocumentoPath({ profileId, tipo, fileId: randomUUID(), mimeType: "application/pdf" });
    if (!path) throw new Error("invalid test path");
    return path;
  }

  function docMetadata(legajoId: string, profileId: string, tipo: DocumentoTipo, uploadedBy: string) {
    return {
      legajo_id: legajoId,
      tipo,
      storage_path: docPath(profileId, tipo),
      file_name: `${tipo}-aprobacion.pdf`,
      mime_type: "application/pdf",
      size_bytes: 10,
      uploaded_by: uploadedBy,
    };
  }

  async function storedDocs(legajoId: string) {
    const { data, error } = await service
      .from("legajo_documentos")
      .select("*")
      .eq("legajo_id", legajoId)
      .order("created_at");
    expect(error).toBeNull();
    return data ?? [];
  }

  beforeAll(async () => {
    empleadoA = await createTestUser(service, "aprob-empleado-a");
    empleadoB = await createTestUser(service, "aprob-empleado-b");
    admin = await createTestUser(service, "aprob-admin", "admin");
    admin2 = await createTestUser(service, "aprob-admin-2", "admin");
    employeeIds.push(empleadoA.id, empleadoB.id);
    legajoA = await legajoIdOf(empleadoA.id);
    legajoB = await legajoIdOf(empleadoB.id);
  });

  // Every test starts from the same legajo A and no requests or documents.
  beforeEach(async () => {
    for (const legajoId of [legajoA, legajoB]) {
      await service.from("solicitudes_cambio").delete().eq("legajo_id", legajoId);
      await service.from("legajo_documentos").delete().eq("legajo_id", legajoId);
      await service.from("legajo_hijos").delete().eq("legajo_id", legajoId);
    }
    const reset = await service.from("legajos").update({ ...PERSONAL, ...LABORAL }).eq("id", legajoA);
    if (reset.error) throw new Error(`legajo reset failed: ${reset.error.message}`);
    const hijos = await service
      .from("legajo_hijos")
      .insert(HIJOS_INICIALES.map((hijo) => ({ legajo_id: legajoA, ...hijo })));
    if (hijos.error) throw new Error(`children reset failed: ${hijos.error.message}`);
  });

  afterAll(async () => {
    await deleteTestUsers(service, [...employeeIds, admin.id, admin2.id]);
  });

  describe("allow-list", () => {
    it("matches the application list exactly", async () => {
      const { data, error } = await empleadoA.client.rpc("campos_solicitud_permitidos");
      expect(error).toBeNull();
      expect([...(data ?? [])].sort()).toEqual([...CAMPO_SOLICITUD_CODES].sort());
    });
  });

  describe("legajos: direct writes", () => {
    it("an Empleado can no longer update own groups A to D, and still cannot touch group E", async () => {
      const before = await storedLegajo(legajoA);
      for (const update of [{ nombres: "Directo" }, { emergencia_telefono: "1199999999" }, { area: "Otra" }, { bruto_mensual: 1 }] as LegajoUpdate[]) {
        const { data, error } = await empleadoA.client.from("legajos").update(update).eq("id", legajoA).select();
        expect(error, JSON.stringify(update)).toBeNull();
        expect(data, JSON.stringify(update)).toEqual([]);
      }
      expect(await storedLegajo(legajoA)).toEqual(before);
    });
  });

  describe("empleado submits", () => {
    it("crear_solicitud creates a pending request with its items, submitted by the caller", async () => {
      const id = await crearSolicitud(empleadoA.client, legajoA, [
        { campo: "nombres", valor_propuesto: "Nuevo Nombre (prueba)" },
        { campo: "piso_depto", valor_propuesto: null },
        { campo: "hijos", valor_propuesto: "[]" },
      ]);
      const stored = await storedSolicitud(id);
      expect(stored).toMatchObject({
        legajo_id: legajoA,
        estado: "pendiente",
        solicitado_por: empleadoA.id,
        motivo_rechazo: null,
        revisado_por: null,
        revisado_en: null,
      });

      // valor_anterior comes from the legajo.
      const { data: items } = await empleadoA.client
        .from("solicitudes_cambio_items")
        .select("campo, valor_propuesto, valor_anterior")
        .eq("solicitud_id", id)
        .order("campo");
      expect(items).toHaveLength(3);
      expect(items?.[0]).toEqual({ campo: "hijos", valor_propuesto: "[]", valor_anterior: expect.any(String) });
      expect(parseHijosValor(items?.[0]?.valor_anterior ?? null)).toEqual(HIJOS_INICIALES);
      expect(items?.[1]).toEqual({ campo: "nombres", valor_propuesto: "Nuevo Nombre (prueba)", valor_anterior: PERSONAL.nombres });
      expect(items?.[2]).toEqual({ campo: "piso_depto", valor_propuesto: null, valor_anterior: PERSONAL.piso_depto });

      // The legajo does not change while the request is pending.
      expect((await storedLegajo(legajoA)).nombres).toBe(PERSONAL.nombres);
    });

    it("fails for another employee's legajo", async () => {
      const { data, error } = await empleadoA.client.rpc("crear_solicitud", {
        p_legajo_id: legajoB,
        p_items: [{ campo: "nombres", valor_propuesto: "Intruso" }],
      });
      expect(data).toBeNull();
      expect(error?.code).toBe(PERMISSION_DENIED);
      expect(await solicitudesDe(legajoB)).toEqual([]);
    });

    it("fails for an Admin, even on their own legajo", async () => {
      const legajoAdmin = await legajoIdOf(admin.id);
      const { data, error } = await admin.client.rpc("crear_solicitud", {
        p_legajo_id: legajoAdmin,
        p_items: [{ campo: "nombres", valor_propuesto: "Admin (prueba)" }],
      });
      expect(data).toBeNull();
      expect(error?.code).toBe(PERMISSION_DENIED);
      expect(await solicitudesDe(legajoAdmin)).toEqual([]);
    });

    it("fails with an empty, missing or malformed item list", async () => {
      const invalid: unknown[] = [
        [],
        null,
        {},
        "nombres",
        [{ campo: "nombres" }],
        [{ valor_propuesto: "x" }],
        [{ campo: "nombres", valor_propuesto: "x", valor_anterior: "y" }],
        [{ campo: 1, valor_propuesto: "x" }],
        [{ campo: "nombres", valor_propuesto: 5 }],
        ["nombres"],
      ];
      for (const items of invalid) {
        const { data, error } = await empleadoA.client.rpc("crear_solicitud", {
          p_legajo_id: legajoA,
          p_items: items as never,
        });
        expect(data, JSON.stringify(items)).toBeNull();
        expect(error?.code, JSON.stringify(items)).toBe(INVALID_PARAMETER);
      }
      expect(await solicitudesDe(legajoA)).toEqual([]);
    });

    it("fails when a field appears twice", async () => {
      const { error } = await empleadoA.client.rpc("crear_solicitud", {
        p_legajo_id: legajoA,
        p_items: [
          { campo: "alergias", valor_propuesto: "Polen" },
          { campo: "alergias", valor_propuesto: "Ácaros" },
        ],
      });
      expect(error?.code).toBe(INVALID_PARAMETER);
      expect(await solicitudesDe(legajoA)).toEqual([]);
    });

    it("rejects a group E field, a key or a column outside the allow-list, leaving no header behind", async () => {
      for (const campo of ["area", "bruto_mensual", "estado_laboral", "numero_legajo", "profile_id", "id", "updated_at", "no_existe"]) {
        const { error } = await empleadoA.client.rpc("crear_solicitud", {
          p_legajo_id: legajoA,
          // A valid item first: the whole submission must still fail.
          p_items: [
            { campo: "alergias", valor_propuesto: "Polen" },
            { campo, valor_propuesto: "1" },
          ],
        });
        expect(error?.code, campo).toBe(CHECK_VIOLATION);
      }
      expect(await solicitudesDe(legajoA)).toEqual([]);
      const { count } = await service
        .from("solicitudes_cambio_items")
        .select("id", { count: "exact", head: true })
        .eq("campo", "alergias")
        .eq("valor_propuesto", "Polen");
      expect(count).toBe(0);
    });

    it("rejects a value that does not fit the field, leaving no header behind", async () => {
      const invalid: ItemInput[] = [
        { campo: "fecha_nacimiento", valor_propuesto: "no es una fecha" },
        { campo: "fecha_nacimiento", valor_propuesto: "1990-02-30" },
        { campo: "estado_civil", valor_propuesto: "comprometido" },
        { campo: "tiene_hijos", valor_propuesto: "sí" },
        { campo: "hijos", valor_propuesto: null },
        { campo: "hijos", valor_propuesto: "no json" },
        { campo: "hijos", valor_propuesto: '{"nombre_completo":"Hijo"}' },
        { campo: "hijos", valor_propuesto: "[1]" },
        { campo: "hijos", valor_propuesto: '["Hijo"]' },
        { campo: "hijos", valor_propuesto: '[{"nombre_completo":"Hijo"}]' },
        { campo: "hijos", valor_propuesto: '[{"nombre_completo":" ","fecha_nacimiento":"2015-01-01"}]' },
        { campo: "hijos", valor_propuesto: '[{"nombre_completo":"Hijo","fecha_nacimiento":"2015-13-01"}]' },
        { campo: "hijos", valor_propuesto: '[{"nombre_completo":"Hijo","fecha_nacimiento":"2015-01-01","dni":"1"}]' },
      ];
      for (const item of invalid) {
        const { error } = await empleadoA.client.rpc("crear_solicitud", {
          p_legajo_id: legajoA,
          p_items: [{ campo: "alergias", valor_propuesto: "Polen" }, item],
        });
        expect(error?.code, JSON.stringify(item)).toBe(CHECK_VIOLATION);
      }
      expect(await solicitudesDe(legajoA)).toEqual([]);
    });

    it("allows only one pending request per legajo", async () => {
      await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      const { data, error } = await empleadoA.client.rpc("crear_solicitud", {
        p_legajo_id: legajoA,
        p_items: [{ campo: "nombres", valor_propuesto: "Segunda" }],
      });
      expect(data).toBeNull();
      expect(error?.code).toBe(UNIQUE_VIOLATION);
      expect(error?.message).toContain(SOLICITUD_PENDIENTE_INDEX);
      expect(await solicitudesDe(legajoA)).toHaveLength(1);
    });

    it("rejects direct inserts into either table, for Empleado and Admin", async () => {
      const own = await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      const legajoAdmin = await legajoIdOf(admin.id);
      const attempts: [TypedClient, string, string][] = [
        [empleadoA.client, legajoA, own],
        [admin.client, legajoAdmin, own],
      ];
      for (const [client, legajoId, solicitudId] of attempts) {
        const header = await client.from("solicitudes_cambio").insert({ legajo_id: legajoId }).select();
        expect(header.error?.code).toBe(PERMISSION_DENIED);
        const item = await client
          .from("solicitudes_cambio_items")
          .insert({ solicitud_id: solicitudId, campo: "nombres", valor_propuesto: "Directo" })
          .select();
        expect(item.error?.code).toBe(PERMISSION_DENIED);
      }
      const { count } = await service
        .from("solicitudes_cambio_items")
        .select("id", { count: "exact", head: true })
        .eq("solicitud_id", own);
      expect(count).toBe(1);
    });

    it("cannot change or delete items and requests", async () => {
      const own = await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      const itemUpdate = await empleadoA.client
        .from("solicitudes_cambio_items")
        .update({ valor_propuesto: "Cambiado" })
        .eq("solicitud_id", own)
        .select();
      expect(itemUpdate.error?.code).toBe(PERMISSION_DENIED);

      const itemDelete = await empleadoA.client.from("solicitudes_cambio_items").delete().eq("solicitud_id", own).select();
      expect(itemDelete.error?.code).toBe(PERMISSION_DENIED);

      const requestDelete = await empleadoA.client.from("solicitudes_cambio").delete().eq("id", own).select();
      expect(requestDelete.error?.code).toBe(PERMISSION_DENIED);

      const adminDelete = await admin.client.from("solicitudes_cambio").delete().eq("id", own).select();
      expect(adminDelete.error?.code).toBe(PERMISSION_DENIED);

      expect((await storedSolicitud(own)).estado).toBe("pendiente");
    });
  });

  describe("empleado cancels", () => {
    it("cancels the own pending request, which frees the legajo for a new one", async () => {
      const id = await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      const { data, error } = await empleadoA.client
        .from("solicitudes_cambio")
        .update({ estado: "cancelada" })
        .eq("id", id)
        .select();
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(await storedSolicitud(id)).toMatchObject({ estado: "cancelada", revisado_por: null, revisado_en: null });

      await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Ácaros" }]);
    });

    it("cannot approve or reject the own request, or set the review columns", async () => {
      const id = await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      for (const estado of ["aprobada", "rechazada"] as const) {
        const { error } = await empleadoA.client.from("solicitudes_cambio").update({ estado }).eq("id", id).select();
        expect(error?.code, estado).toBe(PERMISSION_DENIED);
      }
      const reviewer = await empleadoA.client
        .from("solicitudes_cambio")
        .update({ revisado_por: empleadoA.id })
        .eq("id", id)
        .select();
      expect(reviewer.error?.code).toBe(PERMISSION_DENIED);
      expect((await storedSolicitud(id)).estado).toBe("pendiente");
    });

    it("cannot cancel another employee's request", async () => {
      const deB = await solicitudDeServicio(legajoB, empleadoB.id);
      const { data, error } = await empleadoA.client
        .from("solicitudes_cambio")
        .update({ estado: "cancelada" })
        .eq("id", deB)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect((await storedSolicitud(deB)).estado).toBe("pendiente");
    });

    it("cannot cancel a request that was already decided", async () => {
      const id = await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      expect((await admin.client.rpc("rechazar_solicitud", { p_solicitud_id: id, p_motivo: "No corresponde" })).error).toBeNull();

      const { data, error } = await empleadoA.client
        .from("solicitudes_cambio")
        .update({ estado: "cancelada" })
        .eq("id", id)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect((await storedSolicitud(id)).estado).toBe("rechazada");
    });

    it("admin cannot flip a request's state by hand", async () => {
      const id = await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      const { data, error } = await admin.client
        .from("solicitudes_cambio")
        .update({ estado: "cancelada" })
        .eq("id", id)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect((await storedSolicitud(id)).estado).toBe("pendiente");
    });
  });

  describe("reading requests", () => {
    it("an Empleado cannot read another employee's requests or items", async () => {
      const deB = await solicitudDeServicio(legajoB, empleadoB.id);

      const all = await empleadoA.client.from("solicitudes_cambio").select("id, legajo_id");
      expect(all.error).toBeNull();
      expect(all.data?.filter((row) => row.legajo_id !== legajoA)).toEqual([]);

      const byId = await empleadoA.client.from("solicitudes_cambio").select("*").eq("id", deB);
      expect(byId.data).toEqual([]);

      const items = await empleadoA.client.from("solicitudes_cambio_items").select("*").eq("solicitud_id", deB);
      expect(items.error).toBeNull();
      expect(items.data).toEqual([]);

      // B sees their own.
      const own = await empleadoB.client.from("solicitudes_cambio_items").select("campo").eq("solicitud_id", deB);
      expect(own.data).toEqual([{ campo: "alergias" }]);
    });

    it("an Admin reads every request and item", async () => {
      const deA = await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      const deB = await solicitudDeServicio(legajoB, empleadoB.id);

      const { data, error } = await admin.client.from("solicitudes_cambio").select("id").in("id", [deA, deB]);
      expect(error).toBeNull();
      expect(data?.map((row) => row.id).sort()).toEqual([deA, deB].sort());

      const items = await admin.client.from("solicitudes_cambio_items").select("solicitud_id").in("solicitud_id", [deA, deB]);
      expect(items.data).toHaveLength(2);
    });
  });

  describe("decisions on requests", () => {
    it("aprobar_solicitud applies every field, records who and when, and leaves group E untouched", async () => {
      const id = await crearSolicitud(empleadoA.client, legajoA, [
        { campo: "nombres", valor_propuesto: "Nombre Aprobado (prueba)" },
        { campo: "piso_depto", valor_propuesto: null },
        { campo: "partido", valor_propuesto: "Otro" },
        { campo: "partido_otro", valor_propuesto: "Partido Aprobado (prueba)" },
        { campo: "fecha_nacimiento", valor_propuesto: "1991-02-03" },
        { campo: "estado_civil", valor_propuesto: "casado" },
        { campo: "nombre_conyuge", valor_propuesto: "Cónyuge Aprobado (prueba)" },
        { campo: "tiene_hijos", valor_propuesto: "false" },
        { campo: "emergencia_telefono", valor_propuesto: "1177776666" },
      ]);
      const before = await storedLegajo(legajoA);

      const { error } = await admin.client.rpc("aprobar_solicitud", { p_solicitud_id: id });
      expect(error).toBeNull();

      const after = await storedLegajo(legajoA);
      expect(after).toMatchObject({
        nombres: "Nombre Aprobado (prueba)",
        piso_depto: null,
        partido: "Otro",
        partido_otro: "Partido Aprobado (prueba)",
        fecha_nacimiento: "1991-02-03",
        estado_civil: "casado",
        nombre_conyuge: "Cónyuge Aprobado (prueba)",
        tiene_hijos: false,
        emergencia_telefono: "1177776666",
      });
      // Fields not in the request keep their value.
      expect(after.apellido).toBe(before.apellido);
      expect(after.dni).toBe(before.dni);
      expect(after.alergias).toBe(before.alergias);
      for (const column of Object.keys(LABORAL) as (keyof typeof after)[]) {
        expect(after[column], column).toEqual(before[column]);
      }
      // No "hijos" item: the children stay.
      expect(await storedHijos(legajoA)).toEqual(HIJOS_INICIALES);

      const solicitud = await storedSolicitud(id);
      expect(solicitud.estado).toBe("aprobada");
      expect(solicitud.revisado_por).toBe(admin.id);
      expect(solicitud.revisado_en).not.toBeNull();
      expect(solicitud.motivo_rechazo).toBeNull();
    });

    it("aprobar_solicitud replaces the children set exactly", async () => {
      const nuevos = [
        { nombre_completo: "Hija Nueva (prueba)", fecha_nacimiento: "2020-02-02" },
        { nombre_completo: "Hijo Inicial Uno (prueba)", fecha_nacimiento: "2014-03-03" },
        { nombre_completo: "Hijo Nuevo (prueba)", fecha_nacimiento: "2022-12-12" },
      ];
      const id = await crearSolicitud(empleadoA.client, legajoA, [{ campo: "hijos", valor_propuesto: serializeHijos(nuevos) }]);
      expect((await admin.client.rpc("aprobar_solicitud", { p_solicitud_id: id })).error).toBeNull();
      expect(await storedHijos(legajoA)).toEqual(
        [...nuevos].sort((a, b) => a.fecha_nacimiento.localeCompare(b.fecha_nacimiento)),
      );

      // An empty set clears the children.
      const vaciar = await crearSolicitud(empleadoA.client, legajoA, [
        { campo: "tiene_hijos", valor_propuesto: "false" },
        { campo: "hijos", valor_propuesto: "[]" },
      ]);
      expect((await admin.client.rpc("aprobar_solicitud", { p_solicitud_id: vaciar })).error).toBeNull();
      expect(await storedHijos(legajoA)).toEqual([]);
      expect((await storedLegajo(legajoA)).tiene_hijos).toBe(false);
    });

    it("aprobar_solicitud is all or nothing: a value the legajo rejects changes nothing", async () => {
      // DNI digits are a legajos constraint, checked when the request is approved.
      const id = await crearSolicitud(empleadoA.client, legajoA, [
        { campo: "nombres", valor_propuesto: "No Debería Aplicarse" },
        { campo: "dni", valor_propuesto: "30.000.000" },
        { campo: "hijos", valor_propuesto: "[]" },
      ]);
      const before = await storedLegajo(legajoA);
      const { error } = await admin.client.rpc("aprobar_solicitud", { p_solicitud_id: id });
      expect(error?.code).toBe(CHECK_VIOLATION);
      expect(await storedLegajo(legajoA)).toEqual(before);
      expect(await storedHijos(legajoA)).toEqual(HIJOS_INICIALES);
      expect((await storedSolicitud(id)).estado).toBe("pendiente");
    });

    it("rechazar_solicitud records the reason and changes no legajo data", async () => {
      const id = await crearSolicitud(empleadoA.client, legajoA, [
        { campo: "nombres", valor_propuesto: "Rechazado (prueba)" },
        { campo: "hijos", valor_propuesto: "[]" },
      ]);
      const before = await storedLegajo(legajoA);

      const { error } = await admin.client.rpc("rechazar_solicitud", {
        p_solicitud_id: id,
        p_motivo: "  El nombre no coincide con el DNI.  ",
      });
      expect(error).toBeNull();

      expect(await storedLegajo(legajoA)).toEqual(before);
      expect(await storedHijos(legajoA)).toEqual(HIJOS_INICIALES);
      const solicitud = await storedSolicitud(id);
      expect(solicitud).toMatchObject({
        estado: "rechazada",
        motivo_rechazo: "El nombre no coincide con el DNI.",
        revisado_por: admin.id,
      });
      expect(solicitud.revisado_en).not.toBeNull();

      // The Empleado sees the reason.
      const seen = await empleadoA.client.from("solicitudes_cambio").select("motivo_rechazo").eq("id", id).single();
      expect(seen.data?.motivo_rechazo).toBe("El nombre no coincide con el DNI.");
    });

    it("rechazar_solicitud fails with an empty reason", async () => {
      const id = await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      for (const motivo of ["", "   ", "\t\n"]) {
        const { error } = await admin.client.rpc("rechazar_solicitud", { p_solicitud_id: id, p_motivo: motivo });
        expect(error?.code, JSON.stringify(motivo)).toBe(INVALID_PARAMETER);
      }
      expect((await storedSolicitud(id)).estado).toBe("pendiente");
    });

    it("both functions fail for a non-admin caller", async () => {
      const id = await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      const approve = await empleadoA.client.rpc("aprobar_solicitud", { p_solicitud_id: id });
      expect(approve.error?.code).toBe(PERMISSION_DENIED);
      const reject = await empleadoA.client.rpc("rechazar_solicitud", { p_solicitud_id: id, p_motivo: "No" });
      expect(reject.error?.code).toBe(PERMISSION_DENIED);
      expect((await storedSolicitud(id)).estado).toBe("pendiente");
      expect((await storedLegajo(legajoA)).alergias).toBe(PERSONAL.alergias);
    });

    it("both functions fail for a request that is not pending, or does not exist", async () => {
      const aprobada = await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      expect((await admin.client.rpc("aprobar_solicitud", { p_solicitud_id: aprobada })).error).toBeNull();

      const cancelada = await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Ácaros" }]);
      await empleadoA.client.from("solicitudes_cambio").update({ estado: "cancelada" }).eq("id", cancelada);

      for (const id of [aprobada, cancelada]) {
        const approve = await admin.client.rpc("aprobar_solicitud", { p_solicitud_id: id });
        expect(approve.error?.code).toBe(NOT_PENDING);
        const reject = await admin.client.rpc("rechazar_solicitud", { p_solicitud_id: id, p_motivo: "Tarde" });
        expect(reject.error?.code).toBe(NOT_PENDING);
      }
      expect((await storedSolicitud(aprobada)).estado).toBe("aprobada");
      expect((await storedSolicitud(cancelada)).estado).toBe("cancelada");
      expect((await storedLegajo(legajoA)).alergias).toBe("Polen");

      const missing = await admin.client.rpc("aprobar_solicitud", { p_solicitud_id: randomUUID() });
      expect(missing.error?.code).toBe(NOT_FOUND);
    });
  });

  describe("documents", () => {
    it("an Empleado upload lands as pendiente; an Admin upload lands as aprobado", async () => {
      const own = await empleadoA.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_frente", empleadoA.id))
        .select("estado, revisado_por, revisado_en, motivo_rechazo")
        .single();
      expect(own.error).toBeNull();
      expect(own.data).toEqual({ estado: "pendiente", revisado_por: null, revisado_en: null, motivo_rechazo: null });

      const byAdmin = await admin.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_dorso", admin.id))
        .select("estado, revisado_por, revisado_en")
        .single();
      expect(byAdmin.error).toBeNull();
      expect(byAdmin.data?.estado).toBe("aprobado");
      expect(byAdmin.data?.revisado_por).toBe(admin.id);
      expect(byAdmin.data?.revisado_en).not.toBeNull();
    });

    it("an Empleado cannot set the state or review columns, or approve an own document", async () => {
      const columns = [
        { estado: "aprobado" as const },
        { revisado_por: admin.id },
        { revisado_en: new Date().toISOString() },
        { motivo_rechazo: "x" },
      ];
      for (const extra of columns) {
        const { error } = await empleadoA.client
          .from("legajo_documentos")
          .insert({ ...docMetadata(legajoA, empleadoA.id, "dni_frente", empleadoA.id), ...extra });
        expect(error?.code, Object.keys(extra)[0]).toBe(PERMISSION_DENIED);
      }

      const own = await empleadoA.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_frente", empleadoA.id))
        .select("id")
        .single();
      expect(own.error).toBeNull();
      const id = own.data?.id ?? "";

      const flip = await empleadoA.client.from("legajo_documentos").update({ estado: "aprobado" }).eq("id", id).select();
      expect(flip.error?.code).toBe(PERMISSION_DENIED);

      const approve = await empleadoA.client.rpc("aprobar_documento", { p_documento_id: id });
      expect(approve.error?.code).toBe(PERMISSION_DENIED);
      const reject = await empleadoA.client.rpc("rechazar_documento", { p_documento_id: id, p_motivo: "No" });
      expect(reject.error?.code).toBe(PERMISSION_DENIED);

      expect((await storedDocs(legajoA)).map((doc) => doc.estado)).toEqual(["pendiente"]);
    });

    it("an Empleado can delete an own pending document but not an approved one", async () => {
      const aprobado = await admin.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_frente", admin.id))
        .select("id")
        .single();
      const pendiente = await empleadoA.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_frente", empleadoA.id))
        .select("id")
        .single();

      const deleteApproved = await empleadoA.client.from("legajo_documentos").delete().eq("id", aprobado.data?.id ?? "").select();
      expect(deleteApproved.error).toBeNull();
      expect(deleteApproved.data).toEqual([]);

      const deletePending = await empleadoA.client.from("legajo_documentos").delete().eq("id", pendiente.data?.id ?? "").select();
      expect(deletePending.data).toHaveLength(1);

      expect((await storedDocs(legajoA)).map((doc) => doc.estado)).toEqual(["aprobado"]);
    });

    it("approving a document marks the previous approved one of that type as reemplazado and keeps both", async () => {
      const previo = await admin2.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_frente", admin2.id))
        .select("id")
        .single();
      const nuevo = await empleadoA.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_frente", empleadoA.id))
        .select("id")
        .single();
      // Another type is not affected.
      const otroTipo = await admin.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_dorso", admin.id))
        .select("id")
        .single();

      const { error } = await admin.client.rpc("aprobar_documento", { p_documento_id: nuevo.data?.id ?? "" });
      expect(error).toBeNull();

      const byId = Object.fromEntries((await storedDocs(legajoA)).map((doc) => [doc.id, doc]));
      expect(Object.keys(byId)).toHaveLength(3);
      // A state change does not restamp: the replaced document keeps its reviewer.
      expect(byId[previo.data?.id ?? ""]).toMatchObject({ estado: "reemplazado", revisado_por: admin2.id });
      expect(byId[nuevo.data?.id ?? ""]).toMatchObject({ estado: "aprobado", revisado_por: admin.id });
      expect(byId[nuevo.data?.id ?? ""].revisado_en).not.toBeNull();
      expect(byId[otroTipo.data?.id ?? ""].estado).toBe("aprobado");
    });

    it("rechazar_documento records the reason; decisions fail when not pending or with an empty reason", async () => {
      const doc = await empleadoA.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "licencia_conducir", empleadoA.id))
        .select("id")
        .single();
      const id = doc.data?.id ?? "";

      const empty = await admin.client.rpc("rechazar_documento", { p_documento_id: id, p_motivo: " " });
      expect(empty.error?.code).toBe(INVALID_PARAMETER);

      const { error } = await admin.client.rpc("rechazar_documento", { p_documento_id: id, p_motivo: "La foto está borrosa." });
      expect(error).toBeNull();
      const [stored] = await storedDocs(legajoA);
      expect(stored).toMatchObject({ estado: "rechazado", motivo_rechazo: "La foto está borrosa.", revisado_por: admin.id });

      const again = await admin.client.rpc("aprobar_documento", { p_documento_id: id });
      expect(again.error?.code).toBe(NOT_PENDING);
      const rejectAgain = await admin.client.rpc("rechazar_documento", { p_documento_id: id, p_motivo: "Otra vez" });
      expect(rejectAgain.error?.code).toBe(NOT_PENDING);

      // A rejected document does not block a new pending upload of that type.
      const retry = await empleadoA.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "licencia_conducir", empleadoA.id));
      expect(retry.error).toBeNull();
    });

    it("an Admin replacing a decided document in place becomes its reviewer", async () => {
      const original = await admin2.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_frente", admin2.id))
        .select("id, revisado_por, revisado_en")
        .single();
      expect(original.data?.revisado_por).toBe(admin2.id);

      const replacement = docMetadata(legajoA, empleadoA.id, "dni_frente", admin.id);
      const { data, error } = await admin.client
        .from("legajo_documentos")
        .update({
          storage_path: replacement.storage_path,
          file_name: "dni-frente-reemplazo.pdf",
          size_bytes: 20,
          uploaded_by: admin.id,
        })
        .eq("id", original.data?.id ?? "")
        .select("estado, revisado_por, revisado_en")
        .single();
      expect(error).toBeNull();
      expect(data?.estado).toBe("aprobado");
      expect(data?.revisado_por).toBe(admin.id);
      expect(new Date(data?.revisado_en ?? 0).getTime()).toBeGreaterThan(
        new Date(original.data?.revisado_en ?? 0).getTime(),
      );
    });

    it("an Admin replacing a pending document in place leaves it unreviewed", async () => {
      const pending = await empleadoA.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_frente", empleadoA.id))
        .select("id")
        .single();
      const replacement = docMetadata(legajoA, empleadoA.id, "dni_frente", admin.id);
      const { data, error } = await admin.client
        .from("legajo_documentos")
        .update({ storage_path: replacement.storage_path, uploaded_by: admin.id })
        .eq("id", pending.data?.id ?? "")
        .select("estado, revisado_por, revisado_en")
        .single();
      expect(error).toBeNull();
      expect(data).toEqual({ estado: "pendiente", revisado_por: null, revisado_en: null });
    });

    it("allows at most one pending and one approved document per type", async () => {
      const first = await empleadoA.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_dorso", empleadoA.id));
      expect(first.error).toBeNull();
      const secondPending = await empleadoA.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_dorso", empleadoA.id));
      expect(secondPending.error?.code).toBe(UNIQUE_VIOLATION);
      expect(secondPending.error?.message).toContain(DOCUMENTO_PENDIENTE_INDEX);

      const firstApproved = await admin.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_dorso", admin.id));
      expect(firstApproved.error).toBeNull();
      const secondApproved = await admin.client
        .from("legajo_documentos")
        .insert(docMetadata(legajoA, empleadoA.id, "dni_dorso", admin.id));
      expect(secondApproved.error?.code).toBe(UNIQUE_VIOLATION);
      expect(secondApproved.error?.message).toContain("legajo_documentos_un_aprobado_por_tipo");

      expect((await storedDocs(legajoA)).map((doc) => doc.estado).sort()).toEqual(["aprobado", "pendiente"]);
    });
  });

  describe("pendientes_admin", () => {
    async function serviceCounts() {
      const solicitudes = await service
        .from("solicitudes_cambio")
        .select("id", { count: "exact", head: true })
        .eq("estado", "pendiente");
      const documentos = await service
        .from("legajo_documentos")
        .select("id", { count: "exact", head: true })
        .eq("estado", "pendiente");
      return { solicitudes: solicitudes.count ?? -1, documentos: documentos.count ?? -1 };
    }

    it("returns the pending counts for an Admin", async () => {
      const before = await admin.client.rpc("pendientes_admin").single();
      expect(before.error).toBeNull();
      expect(before.data).toEqual(await serviceCounts());

      await crearSolicitud(empleadoA.client, legajoA, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      await solicitudDeServicio(legajoB, empleadoB.id);
      await empleadoA.client.from("legajo_documentos").insert(docMetadata(legajoA, empleadoA.id, "dni_frente", empleadoA.id));
      // Approved documents are not counted.
      await admin.client.from("legajo_documentos").insert(docMetadata(legajoA, empleadoA.id, "dni_dorso", admin.id));

      const after = await admin.client.rpc("pendientes_admin").single();
      expect(after.error).toBeNull();
      expect(after.data).toEqual({
        solicitudes: (before.data?.solicitudes ?? 0) + 2,
        documentos: (before.data?.documentos ?? 0) + 1,
      });
    });

    it("fails for an Empleado", async () => {
      const { data, error } = await empleadoA.client.rpc("pendientes_admin");
      expect(data).toBeNull();
      expect(error?.code).toBe(PERMISSION_DENIED);
    });
  });

  describe("anonymous", () => {
    it("has no access to the new tables", async () => {
      const anon = anonClient();
      for (const table of ["solicitudes_cambio", "solicitudes_cambio_items"] as const) {
        const { data, error } = await anon.from(table).select("*");
        expect(data, table).toBeNull();
        expect(error?.code, table).toBe(PERMISSION_DENIED);
      }
      const insert = await anon.from("solicitudes_cambio").insert({ legajo_id: legajoA });
      expect(insert.error?.code).toBe(PERMISSION_DENIED);
      const item = await anon
        .from("solicitudes_cambio_items")
        .insert({ solicitud_id: randomUUID(), campo: "nombres", valor_propuesto: "x" });
      expect(item.error?.code).toBe(PERMISSION_DENIED);
    });

    it("cannot call the new functions", async () => {
      const anon = anonClient();
      const id = randomUUID();
      const calls = [
        anon.rpc("crear_solicitud", { p_legajo_id: legajoA, p_items: [{ campo: "nombres", valor_propuesto: "x" }] }),
        anon.rpc("aprobar_solicitud", { p_solicitud_id: id }),
        anon.rpc("rechazar_solicitud", { p_solicitud_id: id, p_motivo: "x" }),
        anon.rpc("aprobar_documento", { p_documento_id: id }),
        anon.rpc("rechazar_documento", { p_documento_id: id, p_motivo: "x" }),
        anon.rpc("pendientes_admin"),
        anon.rpc("campos_solicitud_permitidos"),
      ];
      for (const result of await Promise.all(calls)) {
        expect(result.data).toBeNull();
        expect(result.error?.code).toBe(PERMISSION_DENIED);
      }
    });
  });

  describe("cascade", () => {
    it("deleting a profile removes its requests and items", async () => {
      const user = await createTestUser(service, "aprob-cascade");
      const legajo = await legajoIdOf(user.id);
      // One decided request (reviewed by the admin) and one pending.
      const id = await crearSolicitud(user.client, legajo, [{ campo: "alergias", valor_propuesto: "Polen" }]);
      expect((await admin.client.rpc("rechazar_solicitud", { p_solicitud_id: id, p_motivo: "Prueba" })).error).toBeNull();
      const pending = await crearSolicitud(user.client, legajo, [{ campo: "alergias", valor_propuesto: "Ácaros" }]);
      const { count } = await service
        .from("solicitudes_cambio_items")
        .select("id", { count: "exact", head: true })
        .in("solicitud_id", [id, pending]);
      expect(count).toBe(2);

      const deleted = await service.auth.admin.deleteUser(user.id);
      expect(deleted.error).toBeNull();

      const requests = await service.from("solicitudes_cambio").select("id").in("id", [id, pending]);
      expect(requests.data).toEqual([]);
      const items = await service.from("solicitudes_cambio_items").select("id").in("solicitud_id", [id, pending]);
      expect(items.data).toEqual([]);
    });
  });
});
