import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DOCUMENTOS_BUCKET } from "@/lib/documentos/tipos";
import type { Database } from "@/lib/supabase/database.types";
import { legajoIdDe, rutaDocumento } from "./actores";
import { anonClient, createTestUser, deleteTestUsers, serviceClient, TEST_PASSWORD, uniqueEmail, type TestUser, type TypedClient } from "./helpers";

// F1-11A, GAP-03: triggers and internal SECURITY DEFINER functions, through
// their public boundary (PostgREST and RPC as the signed-in users). Each
// refusal is asserted with its exact SQLSTATE and HINT, and with the rows
// (and, for documents, the storage metadata) left exactly as they were.

type LegajoUpdate = Database["public"]["Tables"]["legajos"]["Update"];

const LOCKED = "55000";
const PERMISSION_DENIED = "42501";
const CHECK_VIOLATION = "23514";
const INVALID_PARAMETER = "22023";

// A complete legajo for groups A to D.
const GRUPOS_A_D = {
  nombres: "Prueba",
  apellido: "Disparadores",
  dni: "12345678",
  nacionalidad: "Argentina",
  cuil: "20-12345678-6",
  fecha_nacimiento: "1990-01-01",
  calle_altura: "Calle 1",
  piso_depto: "1A",
  localidad: "Localidad",
  partido: "Tigre",
  partido_otro: null,
  telefono_celular: "11 4444-5555",
  email_personal: "prueba@example.test",
  estado_civil: "soltero" as const,
  nombre_conyuge: null,
  tiene_hijos: true,
  grupo_sanguineo: "0+",
  alergias: "Ninguna",
  medicacion_habitual: "Ninguna",
  obra_social: "OSDE",
  numero_afiliado: "123",
  emergencia_nombre: "Contacto",
  emergencia_parentesco: "Madre",
  emergencia_domicilio: "Calle 2",
  emergencia_telefono: "11 5555-6666",
};

// A different, well-typed value for every group A to D column. The lock
// refuses in a BEFORE trigger, ahead of the table constraints.
const OTROS_A_D: Required<Pick<LegajoUpdate, keyof typeof GRUPOS_A_D>> = {
  nombres: "Otro",
  apellido: "Otro",
  dni: "87654321",
  nacionalidad: "Uruguaya",
  cuil: "20-87654321-3",
  fecha_nacimiento: "1985-05-05",
  calle_altura: "Calle 9",
  piso_depto: "9B",
  localidad: "Otra",
  partido: "Quilmes",
  partido_otro: "Algo",
  telefono_celular: "11 0000-0000",
  email_personal: "otro@example.test",
  estado_civil: "casado",
  nombre_conyuge: "Cónyuge",
  tiene_hijos: false,
  grupo_sanguineo: "A-",
  alergias: "Polen",
  medicacion_habitual: "Ibuprofeno",
  obra_social: "IOMA",
  numero_afiliado: "999",
  emergencia_nombre: "Otro contacto",
  emergencia_parentesco: "Padre",
  emergencia_domicilio: "Calle 3",
  emergencia_telefono: "11 7777-8888",
};

// A different value for every group E column.
const OTROS_E: Required<
  Pick<LegajoUpdate, "numero_legajo" | "area" | "puesto" | "fecha_ingreso" | "estado_laboral" | "sede" | "modalidad" | "convenio" | "bruto_mensual">
> = {
  numero_legajo: `E-${Date.now()}`,
  area: "Intrusa",
  puesto: "Intruso",
  fecha_ingreso: "2001-01-01",
  estado_laboral: "en_prueba",
  sede: "Otra sede",
  modalidad: "Remota",
  convenio: "Otro",
  bruto_mensual: 1,
};

describe("triggers and internal functions (GAP-03)", () => {
  const service = serviceClient();
  const storage = service.storage.from(DOCUMENTOS_BUCKET);
  let admin: TestUser;
  let empleado: TestUser;
  let otro: TestUser;
  let legajo: string;
  let legajoOtro: string;
  const creados: string[] = [];
  const paths: string[] = [];

  const legajoDe = async (id: string) => (await service.from("legajos").select("*").eq("id", id).single()).data!;
  const hijosDe = async (id: string) => (await service.from("legajo_hijos").select("*").eq("legajo_id", id).order("id")).data ?? [];

  async function crearSolicitud(items: { campo: string; valor_propuesto: string | null }[], user = empleado, legajoId = legajo) {
    const { data, error } = await user.client.rpc("crear_solicitud", { p_legajo_id: legajoId, p_items: items });
    expect(error).toBeNull();
    return data!;
  }

  beforeAll(async () => {
    admin = await createTestUser(service, "disparadores-admin", "admin");
    empleado = await createTestUser(service, "disparadores-empleado");
    otro = await createTestUser(service, "disparadores-otro");
    legajo = await legajoIdDe(service, empleado.id);
    legajoOtro = await legajoIdDe(service, otro.id);
    for (const id of [legajo, legajoOtro]) {
      await service.from("legajos").update(GRUPOS_A_D).eq("id", id);
      await service.from("legajo_hijos").insert({ legajo_id: id, nombre_completo: "Hijo Inicial", fecha_nacimiento: "2015-05-05" });
    }
  }, 60_000);

  beforeEach(async () => {
    await service.from("solicitudes_cambio").delete().in("legajo_id", [legajo, legajoOtro]);
    await service.from("legajo_documentos").delete().in("legajo_id", [legajo, legajoOtro]);
  });

  afterAll(async () => {
    if (paths.length) await storage.remove(paths);
    await deleteTestUsers(service, [...creados, empleado.id, otro.id, admin.id]);
  });

  // -------------------------------------------------------------------------
  describe("bloquear_legajo_pendiente and bloquear_hijos_pendiente", () => {
    beforeEach(async () => {
      await crearSolicitud([{ campo: "alergias", valor_propuesto: "Ácaros" }]);
    });

    it.each(Object.keys(OTROS_A_D) as (keyof typeof OTROS_A_D)[])(
      "refuses an Admin change to %s while a request is pending, leaving the row as it was",
      async (campo) => {
        const antes = await legajoDe(legajo);
        const { data, error } = await admin.client
          .from("legajos")
          .update({ [campo]: OTROS_A_D[campo] } as LegajoUpdate)
          .eq("id", legajo)
          .select("id");
        expect(error?.code).toBe(LOCKED);
        expect(error?.hint).toBe("solicitud_pendiente");
        expect(data).toBeNull();
        expect(await legajoDe(legajo)).toEqual(antes);
      },
    );

    it("refuses every children operation while pending", async () => {
      const antes = await hijosDe(legajo);
      const [hijo] = antes;
      const intentos = await Promise.all([
        admin.client.from("legajo_hijos").insert({ legajo_id: legajo, nombre_completo: "Nuevo", fecha_nacimiento: "2019-01-01" }).select("id"),
        admin.client.from("legajo_hijos").update({ nombre_completo: "Cambiado" }).eq("id", hijo.id).select("id"),
        admin.client.from("legajo_hijos").delete().eq("id", hijo.id).select("id"),
        // Moving another legajo's child into the locked one.
        admin.client.from("legajo_hijos").update({ legajo_id: legajo }).eq("legajo_id", legajoOtro).select("id"),
      ]);
      for (const { error } of intentos) {
        expect(error?.code).toBe(LOCKED);
        expect(error?.hint).toBe("solicitud_pendiente");
      }
      expect(await hijosDe(legajo)).toEqual(antes);
      expect(await hijosDe(legajoOtro)).toHaveLength(1);
    });

    it("still allows every group E field, and a write that changes no group A to D value", async () => {
      const deAdmin = {
        numero_legajo: `A-${Date.now()}`,
        area: "Administración",
        puesto: "Analista",
        fecha_ingreso: "2002-02-02",
        estado_laboral: "activo" as const,
        sede: "Central",
        modalidad: "Híbrida",
        convenio: "Comercio",
        bruto_mensual: 2,
      } satisfies Record<keyof typeof OTROS_E, unknown>;
      const cambio = await admin.client.from("legajos").update(deAdmin).eq("id", legajo).select("area");
      expect(cambio.error).toBeNull();
      expect(cambio.data).toEqual([{ area: "Administración" }]);
      const mismo = await admin.client.from("legajos").update({ nombres: GRUPOS_A_D.nombres }).eq("id", legajo).select("id");
      expect(mismo.error).toBeNull();
      expect(mismo.data).toHaveLength(1);
    });

    it("rolls a multi-row write back entirely when one row is locked", async () => {
      const antes = [await legajoDe(legajo), await legajoDe(legajoOtro)];
      const masivo = await admin.client.from("legajos").update({ alergias: "Masivo" }).in("id", [legajoOtro, legajo]).select("id");
      expect(masivo.error?.code).toBe(LOCKED);
      expect([await legajoDe(legajo), await legajoDe(legajoOtro)]).toEqual(antes);

      const hijosAntes = [await hijosDe(legajo), await hijosDe(legajoOtro)];
      const alta = await admin.client
        .from("legajo_hijos")
        .insert([
          { legajo_id: legajoOtro, nombre_completo: "Libre", fecha_nacimiento: "2019-01-01" },
          { legajo_id: legajo, nombre_completo: "Bloqueado", fecha_nacimiento: "2019-01-01" },
        ])
        .select("id");
      expect(alta.error?.code).toBe(LOCKED);
      expect([await hijosDe(legajo), await hijosDe(legajoOtro)]).toEqual(hijosAntes);
    });

    it("rolls a multi-statement function back entirely: a failed approval keeps the request pending and the lock", async () => {
      // Replace the pending request with one whose value fails a legajo
      // constraint only when applied (DNI digits).
      await service.from("solicitudes_cambio").delete().eq("legajo_id", legajo);
      const solicitud = await crearSolicitud([
        { campo: "alergias", valor_propuesto: "Gatos" },
        { campo: "dni", valor_propuesto: "12A" },
      ]);
      const antes = await legajoDe(legajo);

      const { error } = await admin.client.rpc("aprobar_solicitud", { p_solicitud_id: solicitud });
      expect(error?.code).toBe(CHECK_VIOLATION);
      const { data: estado } = await service.from("solicitudes_cambio").select("estado, revisado_por").eq("id", solicitud).single();
      expect(estado).toEqual({ estado: "pendiente", revisado_por: null });
      expect(await legajoDe(legajo)).toEqual(antes);
      const bloqueado = await admin.client.from("legajos").update({ alergias: "Otra" }).eq("id", legajo).select("id");
      expect(bloqueado.error?.hint).toBe("solicitud_pendiente");
    });
  });

  // -------------------------------------------------------------------------
  describe("hay_solicitud_pendiente", () => {
    it("is not callable by any API role", async () => {
      for (const client of [anonClient(), empleado.client, admin.client]) {
        const { data, error } = await client.rpc("hay_solicitud_pendiente", { p_legajo_id: legajo });
        expect(error?.code).toBe(PERMISSION_DENIED);
        expect(data).toBeNull();
      }
    });

    it("follows the request lifecycle: create locks; cancel, approve and reject release", async () => {
      // Observed through its only use: the lock on an Admin write.
      const bloqueado = async () => {
        const { error } = await admin.client.from("legajos").update({ medicacion_habitual: `Dosis ${Date.now()}` }).eq("id", legajo);
        if (error && error.hint !== "solicitud_pendiente") throw new Error(error.message);
        return error !== null;
      };
      expect(await bloqueado()).toBe(false);

      const cancelada = await crearSolicitud([{ campo: "alergias", valor_propuesto: "Uno" }]);
      expect(await bloqueado()).toBe(true);
      expect((await empleado.client.from("solicitudes_cambio").update({ estado: "cancelada" }).eq("id", cancelada).select("id")).data).toHaveLength(1);
      expect(await bloqueado()).toBe(false);

      const aprobada = await crearSolicitud([{ campo: "alergias", valor_propuesto: "Dos" }]);
      expect(await bloqueado()).toBe(true);
      expect((await admin.client.rpc("aprobar_solicitud", { p_solicitud_id: aprobada })).error).toBeNull();
      expect(await bloqueado()).toBe(false);

      const rechazada = await crearSolicitud([{ campo: "alergias", valor_propuesto: "Tres" }]);
      expect(await bloqueado()).toBe(true);
      expect((await admin.client.rpc("rechazar_solicitud", { p_solicitud_id: rechazada, p_motivo: "No" })).error).toBeNull();
      expect(await bloqueado()).toBe(false);

      // Another employee's request never locks this legajo.
      await crearSolicitud([{ campo: "alergias", valor_propuesto: "Cuatro" }], otro, legajoOtro);
      expect(await bloqueado()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // The trigger is defence in depth: no API path lets a non-Admin update a
  // legajo row at all (legajos_update_admin), so RLS stops every attempt
  // before the trigger would.
  describe("protect_legajo_laboral", () => {
    it.each(Object.keys(OTROS_E) as (keyof typeof OTROS_E)[])(
      "an Empleado cannot change %s by update, upsert or change request",
      async (campo) => {
        const antes = await legajoDe(legajo);
        const valor = { [campo]: OTROS_E[campo] } as LegajoUpdate;

        const update = await empleado.client.from("legajos").update(valor).eq("id", legajo).select("id");
        expect(update.error).toBeNull();
        expect(update.data).toEqual([]);

        const upsert = await empleado.client
          .from("legajos")
          .upsert({ profile_id: empleado.id, ...valor }, { onConflict: "profile_id" })
          .select("id");
        expect(upsert.error?.code).toBe(PERMISSION_DENIED);

        const solicitud = await empleado.client.rpc("crear_solicitud", {
          p_legajo_id: legajo,
          p_items: [{ campo, valor_propuesto: String(OTROS_E[campo]) }],
        });
        expect(solicitud.error?.code).toBe(CHECK_VIOLATION);

        expect(await legajoDe(legajo)).toEqual(antes);
        const { count } = await service.from("solicitudes_cambio").select("id", { count: "exact" }).eq("legajo_id", legajo);
        expect(count).toBe(0);
      },
    );
  });

  // -------------------------------------------------------------------------
  describe("estado_documento_propio", () => {
    it("answers only for a document in the caller's own folder", async () => {
      const propio = rutaDocumento(empleado.id, "dni_frente");
      const ajeno = rutaDocumento(otro.id, "dni_frente");
      for (const [owner, legajoId, path] of [
        [empleado, legajo, propio],
        [otro, legajoOtro, ajeno],
      ] as const) {
        const { error } = await service.from("legajo_documentos").insert({
          legajo_id: legajoId,
          tipo: "dni_frente",
          storage_path: path,
          file_name: "a.pdf",
          mime_type: "application/pdf",
          size_bytes: 10,
          uploaded_by: owner.id,
        });
        expect(error).toBeNull();
      }
      const estado = async (client: TypedClient, path: string) => {
        const { data, error } = await client.rpc("estado_documento_propio", { p_storage_path: path });
        expect(error).toBeNull();
        return data;
      };

      expect(await estado(empleado.client, propio)).toBe("pendiente");
      for (const path of [
        ajeno,
        rutaDocumento(empleado.id, "dni_dorso"),
        "",
        "sin-carpeta",
        `${empleado.id}/../${ajeno}`,
        `../${ajeno}`,
        `/${propio}`,
        propio.toUpperCase(),
      ]) {
        expect(await estado(empleado.client, path), path).toBeNull();
      }
      // Not even an Admin: it is about the caller's own folder.
      expect(await estado(admin.client, propio)).toBeNull();
      expect((await anonClient().rpc("estado_documento_propio", { p_storage_path: propio })).error?.code).toBe(PERMISSION_DENIED);
    });
  });

  // -------------------------------------------------------------------------
  describe("document triggers", () => {
    const base = (owner: TestUser, legajoId: string, tipo: "dni_frente" | "dni_dorso" | "licencia_conducir", uploader: string) => ({
      legajo_id: legajoId,
      tipo,
      storage_path: rutaDocumento(owner.id, tipo),
      file_name: "a.pdf",
      mime_type: "application/pdf",
      size_bytes: 10,
      uploaded_by: uploader,
    });
    const docsDe = async (id: string) => (await service.from("legajo_documentos").select("*").eq("legajo_id", id).order("id")).data ?? [];

    it("set_documento_estado_inicial: the state and review columns cannot be supplied by the client", async () => {
      const intentos = await Promise.all([
        empleado.client.from("legajo_documentos").insert({ ...base(empleado, legajo, "dni_frente", empleado.id), estado: "aprobado" }),
        empleado.client
          .from("legajo_documentos")
          .insert({ ...base(empleado, legajo, "dni_frente", empleado.id), revisado_por: admin.id, revisado_en: new Date().toISOString() }),
        admin.client.from("legajo_documentos").insert({ ...base(empleado, legajo, "dni_dorso", admin.id), estado: "pendiente" }),
        admin.client.from("legajo_documentos").insert({ ...base(empleado, legajo, "dni_dorso", admin.id), motivo_rechazo: "x" }),
        // Nor can an Admin record someone else as the uploader.
        admin.client.from("legajo_documentos").insert(base(empleado, legajo, "dni_dorso", empleado.id)),
      ]);
      for (const { error } of intentos) expect(error?.code).toBe(PERMISSION_DENIED);
      expect(await docsDe(legajo)).toEqual([]);

      const pendiente = await empleado.client
        .from("legajo_documentos")
        .insert(base(empleado, legajo, "dni_frente", empleado.id))
        .select("estado, revisado_por, revisado_en, motivo_rechazo")
        .single();
      expect(pendiente.data).toEqual({ estado: "pendiente", revisado_por: null, revisado_en: null, motivo_rechazo: null });

      const inicio = Date.now();
      const aprobado = await admin.client
        .from("legajo_documentos")
        .insert(base(empleado, legajo, "dni_dorso", admin.id))
        .select("estado, revisado_por, revisado_en")
        .single();
      expect(aprobado.data).toMatchObject({ estado: "aprobado", revisado_por: admin.id });
      expect(new Date(aprobado.data!.revisado_en!).getTime()).toBeGreaterThan(inicio - 60_000);
    });

    it("restamp_documento_reemplazo: only an Admin's file change on a decided document restamps the review", async () => {
      const antiguo = "2020-01-01T00:00:00+00:00";
      const { data: decidido } = await service
        .from("legajo_documentos")
        .insert({ ...base(empleado, legajo, "dni_frente", otro.id), estado: "aprobado", revisado_por: otro.id, revisado_en: antiguo })
        .select("id")
        .single();
      const { data: pendiente } = await service
        .from("legajo_documentos")
        .insert(base(empleado, legajo, "dni_dorso", empleado.id))
        .select("id")
        .single();
      const revision = async (id: string) =>
        (await service.from("legajo_documentos").select("estado, revisado_por, revisado_en, file_name, storage_path").eq("id", id).single()).data!;

      // Direct writes to the review columns are not granted.
      for (const cambio of [{ revisado_por: admin.id }, { estado: "rechazado" as const }, { reemplazado_por: admin.id }]) {
        const { error } = await admin.client.from("legajo_documentos").update(cambio).eq("id", decidido!.id);
        expect(error?.code, JSON.stringify(cambio)).toBe(PERMISSION_DENIED);
      }
      const sinCambio = await revision(decidido!.id);
      expect(sinCambio).toMatchObject({ estado: "aprobado", revisado_por: otro.id });

      // A name change does not restamp.
      await admin.client.from("legajo_documentos").update({ file_name: "renombrado.pdf", uploaded_by: admin.id }).eq("id", decidido!.id);
      expect(await revision(decidido!.id)).toMatchObject({ file_name: "renombrado.pdf", revisado_por: otro.id });
      expect(new Date((await revision(decidido!.id)).revisado_en!).toISOString()).toBe(new Date(antiguo).toISOString());

      // A file change does.
      const nuevaRuta = rutaDocumento(empleado.id, "dni_frente");
      const cambio = await admin.client
        .from("legajo_documentos")
        .update({ storage_path: nuevaRuta, uploaded_by: admin.id })
        .eq("id", decidido!.id)
        .select("id");
      expect(cambio.error).toBeNull();
      const restampado = await revision(decidido!.id);
      expect(restampado).toMatchObject({ storage_path: nuevaRuta, revisado_por: admin.id, estado: "aprobado" });
      expect(new Date(restampado.revisado_en!).getTime()).toBeGreaterThan(new Date(antiguo).getTime());

      // A pending document keeps no reviewer.
      await admin.client
        .from("legajo_documentos")
        .update({ storage_path: rutaDocumento(empleado.id, "dni_dorso"), uploaded_by: admin.id })
        .eq("id", pendiente!.id);
      expect(await revision(pendiente!.id)).toMatchObject({ estado: "pendiente", revisado_por: null, revisado_en: null });
    });

    it("a refused document write leaves the stored object's metadata untouched", async () => {
      const path = rutaDocumento(empleado.id, "licencia_conducir");
      paths.push(path);
      expect((await storage.upload(path, Buffer.from("%PDF-1.4\n%%EOF\n"), { contentType: "application/pdf" })).error).toBeNull();
      const metadata = async () => (await storage.list(`${empleado.id}/licencia_conducir`)).data?.find((o) => path.endsWith(o.name));
      const antes = await metadata();

      const { error } = await empleado.client
        .from("legajo_documentos")
        .insert({ ...base(empleado, legajo, "licencia_conducir", empleado.id), storage_path: path, estado: "aprobado" });
      expect(error?.code).toBe(PERMISSION_DENIED);
      expect(await metadata()).toEqual(antes);
      expect(await docsDe(legajo)).toEqual([]);
    });

    it("set_solicitud_item_valor_anterior: filled from the legajo; the client cannot supply it", async () => {
      const solicitud = await crearSolicitud([
        { campo: "nombres", valor_propuesto: "Nuevo" },
        { campo: "fecha_nacimiento", valor_propuesto: "1991-02-03" },
        { campo: "tiene_hijos", valor_propuesto: "false" },
        { campo: "hijos", valor_propuesto: "[]" },
      ]);
      const { data: items } = await service
        .from("solicitudes_cambio_items")
        .select("campo, valor_anterior")
        .eq("solicitud_id", solicitud)
        .order("campo");
      const anteriores = Object.fromEntries((items ?? []).map((item) => [item.campo, item.valor_anterior]));
      expect(anteriores).toEqual({
        fecha_nacimiento: "1990-01-01",
        hijos: expect.any(String),
        nombres: "Prueba",
        tiene_hijos: "true",
      });
      expect(JSON.parse(anteriores.hijos!)).toEqual([{ nombre_completo: "Hijo Inicial", fecha_nacimiento: "2015-05-05" }]);

      await service.from("solicitudes_cambio").delete().eq("id", solicitud);
      const conAnterior = await empleado.client.rpc("crear_solicitud", {
        p_legajo_id: legajo,
        p_items: [{ campo: "nombres", valor_propuesto: "Nuevo", valor_anterior: "Falso" }],
      });
      expect(conAnterior.error?.code).toBe(INVALID_PARAMETER);

      const directo = await empleado.client
        .from("solicitudes_cambio_items")
        .insert({ solicitud_id: solicitud, campo: "nombres", valor_propuesto: "x", valor_anterior: "Falso" });
      expect(directo.error?.code).toBe(PERMISSION_DENIED);
      const { count } = await service.from("solicitudes_cambio").select("id", { count: "exact" }).eq("legajo_id", legajo);
      expect(count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Sign-up is disabled ([auth] enable_signup = false): accounts come only
  // from the Auth Admin API, which the Admin account module calls.
  describe("handle_new_user and handle_new_profile", () => {
    it("self sign-up is refused", async () => {
      const email = uniqueEmail("disparadores-signup");
      const { error } = await anonClient().auth.signUp({
        email,
        password: TEST_PASSWORD,
        options: { data: { role: "admin", estado_cuenta: "inactiva" } },
      });
      expect(error).not.toBeNull();
      const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
      expect(data.users.map((user) => user.email)).not.toContain(email);
    });

    it("metadata cannot set the role or the account state; an empty legajo is created", async () => {
      const email = uniqueEmail("disparadores-metadata");
      const { data, error } = await service.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { role: "admin", estado_cuenta: "inactiva", debe_cambiar_password: true },
        app_metadata: { role: "admin" },
      });
      expect(error).toBeNull();
      const id = data.user!.id;
      creados.push(id);

      const { data: perfil } = await service.from("profiles").select("role, estado_cuenta, debe_cambiar_password").eq("id", id).single();
      expect(perfil).toEqual({ role: "empleado", estado_cuenta: "activa", debe_cambiar_password: false });
      const { data: nuevo } = await service.from("legajos").select("*").eq("profile_id", id).single();
      expect(nuevo).toMatchObject({ nombres: null, apellido: null, numero_legajo: null, bruto_mensual: null });

      const client = anonClient();
      expect((await client.auth.signInWithPassword({ email, password: TEST_PASSWORD })).error).toBeNull();
      expect((await client.rpc("is_admin")).data).toBe(false);
      expect((await client.rpc("current_app_role")).data).toBe("empleado");
    });
  });
});
