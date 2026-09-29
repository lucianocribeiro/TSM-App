import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOCUMENTOS_BUCKET } from "@/lib/documentos/tipos";
import type { Database } from "@/lib/supabase/database.types";
import {
  crearCambioForzado,
  crearDesactivado,
  instantanea,
  legajoIdDe,
  segundosHastaExpirar,
  sembrar,
  sesionCerrada,
  type ActorCapturado,
  type Semilla,
} from "./actores";
import { createTestUser, deleteTestUsers, serviceClient, type TestUser, type TypedClient } from "./helpers";
import { ACTORES_ESTADO, ejecutarCelda, OPS, TABLAS, type Llamante, type Titular } from "./matriz-acceso";

// F1-11A, GAP-01: account state at the database (Constitution §4 and §10,
// v0.6).
// - A deactivated account, holding an access token captured before the
//   deactivation (still unexpired, its session already closed), reaches no
//   table, no bucket object and no function, except SELECT of its own
//   profiles row. An inactive Admin has no Admin power left either.
// - A pending forced password change is enforced by the app, not the
//   database, by design: that user is the owner of the data and reaches it
//   through the API exactly as an active Empleado. The Server Actions refuse
//   them: cambio-forzado-acciones.test.ts and acciones-frontera.test.ts.

describe("account state at the database (GAP-01)", () => {
  const service = serviceClient();
  let admin: TestUser;
  let victima: TestUser;
  let desactivado: ActorCapturado;
  let adminDesactivado: ActorCapturado;
  let forzado: ActorCapturado;
  const titulares = new Map<string, Titular>();

  beforeAll(async () => {
    admin = await createTestUser(service, "estado-admin", "admin");
    victima = await createTestUser(service, "estado-victima");
    desactivado = await crearDesactivado(service, admin, "estado-desactivado");
    adminDesactivado = await crearDesactivado(service, admin, "estado-admin-desactivado", "admin");
    forzado = await crearCambioForzado(service, admin, "estado-forzado");
    for (const user of [victima, desactivado, adminDesactivado, forzado]) {
      titulares.set(user.id, { id: user.id, legajoId: await legajoIdDe(service, user.id) });
    }
  }, 120_000);

  afterAll(async () => {
    await deleteTestUsers(service, [victima.id, desactivado.id, forzado.id, adminDesactivado.id, admin.id]);
  });

  describe("the fixtures reproduce the real window", () => {
    it("the captured tokens are unexpired, their sessions are closed, and the states are stored", async () => {
      for (const actor of [desactivado, adminDesactivado, forzado]) {
        expect(segundosHastaExpirar(actor.token), actor.email).toBeGreaterThan(300);
        expect(await sesionCerrada(actor.refresh), actor.email).toBe(true);
      }
      const { data } = await service
        .from("profiles")
        .select("id, role, estado_cuenta, debe_cambiar_password")
        .in("id", [desactivado.id, adminDesactivado.id, forzado.id]);
      const porId = new Map((data ?? []).map((perfil) => [perfil.id, perfil]));
      expect(porId.get(desactivado.id)).toMatchObject({ role: "empleado", estado_cuenta: "inactiva" });
      expect(porId.get(adminDesactivado.id)).toMatchObject({ role: "admin", estado_cuenta: "inactiva" });
      expect(porId.get(forzado.id)).toMatchObject({ estado_cuenta: "activa", debe_cambiar_password: true });
    });
  });

  // The matrix runs before any seeded data exists (its cells create their
  // own; one pending request and one pending document per type at a time).
  describe("access matrix: account-state actors", () => {
    function actor(nombre: (typeof ACTORES_ESTADO)[number]): { llamante: Llamante; titular: Titular } {
      const de = (user: TestUser) => titulares.get(user.id)!;
      switch (nombre) {
        case "desactivado-propio":
          return { llamante: { cliente: desactivado.porToken, id: desactivado.id }, titular: de(desactivado) };
        case "admin-desactivado-ajeno":
          return { llamante: { cliente: adminDesactivado.porToken, id: adminDesactivado.id }, titular: de(victima) };
        case "admin-desactivado-propio":
          return { llamante: { cliente: adminDesactivado.porToken, id: adminDesactivado.id }, titular: de(adminDesactivado) };
        case "cambio-forzado-propio":
          return { llamante: { cliente: forzado.porToken, id: forzado.id }, titular: de(forzado) };
      }
    }

    for (const [tabla, espec] of Object.entries(TABLAS)) {
      describe(tabla, () => {
        for (const nombre of ACTORES_ESTADO) {
          for (const op of OPS) {
            const esperado = espec.esperado[nombre][op];
            it(`${nombre} ${op}: ${esperado}`, async () => {
              const { llamante, titular } = actor(nombre);
              const { resultado, antes, despues } = await ejecutarCelda(service, espec, op, llamante, titular);
              expect(resultado).toBe(esperado);
              if (esperado !== "permitido") expect(despues).toEqual(antes);
            });
          }
        }
      });
    }
  });

  describe("with seeded data", () => {
    let semillas: Map<string, Semilla>;

    beforeAll(async () => {
      semillas = new Map();
      for (const user of [victima, desactivado, adminDesactivado, forzado]) {
        semillas.set(user.id, await sembrar(service, user, admin.id));
      }
    }, 60_000);

    it("a deactivated user lists nothing but their own profiles row, though their data exists", async () => {
      const propio = semillas.get(desactivado.id)!;
      const c = desactivado.porToken;

      const perfiles = await c.from("profiles").select("id, estado_cuenta");
      expect(perfiles.error).toBeNull();
      expect(perfiles.data).toEqual([{ id: desactivado.id, estado_cuenta: "inactiva" }]);

      const listados = await Promise.all([
        c.from("legajos").select("id"),
        c.from("legajo_hijos").select("id"),
        c.from("legajo_documentos").select("id"),
        c.from("solicitudes_cambio").select("id"),
        c.from("solicitudes_cambio_items").select("id"),
        c.from("cuenta_eventos").select("id"),
      ]);
      for (const listado of listados) {
        expect(listado.error).toBeNull();
        expect(listado.data).toEqual([]);
      }

      const bucket = c.storage.from(DOCUMENTOS_BUCKET);
      expect((await bucket.download(propio.docPendientePath)).data).toBeNull();
      expect((await bucket.createSignedUrl(propio.docAprobadoPath, 60)).data).toBeNull();
      expect((await bucket.list(`${desactivado.id}/licencia_conducir`)).data ?? []).toEqual([]);

      // The data is there: the service role sees it, including the deactivation event.
      const { count } = await service.from("legajo_documentos").select("id", { count: "exact" }).eq("legajo_id", propio.legajoId);
      expect(count).toBe(2);
      const eventos = await service.from("cuenta_eventos").select("tipo").eq("profile_id", desactivado.id);
      expect(eventos.data?.map((evento) => evento.tipo)).toContain("desactivacion");
    });

    it("the forced-change user, with their new session, reads their own data as an active Empleado", async () => {
      const propio = semillas.get(forzado.id)!;
      const c = forzado.client;
      expect((await c.from("profiles").select("debe_cambiar_password").eq("id", forzado.id)).data).toEqual([
        { debe_cambiar_password: true },
      ]);
      expect((await c.from("legajos").select("id")).data).toEqual([{ id: propio.legajoId }]);
      expect((await c.from("solicitudes_cambio").select("id")).data).toEqual([{ id: propio.solicitudId }]);
      expect((await c.from("solicitudes_cambio_items").select("campo")).data).toEqual([{ campo: "alergias" }]);
      expect((await c.from("legajo_documentos").select("id")).data?.map((d) => d.id).sort()).toEqual(
        [propio.docPendienteId, propio.docAprobadoId].sort(),
      );
      expect((await c.from("cuenta_eventos").select("tipo")).data?.map((evento) => evento.tipo)).toContain("password_temporal");
      expect((await c.storage.from(DOCUMENTOS_BUCKET).download(propio.docAprobadoPath)).data).not.toBeNull();
      expect((await c.rpc("current_app_role")).data).toBe("empleado");
      expect((await c.rpc("cuenta_activa")).data).toBe(true);
    });

    it("an active Admin still reads and manages a deactivated user's data", async () => {
      const propio = semillas.get(desactivado.id)!;
      const c = admin.client;
      expect((await c.from("legajos").select("id").eq("profile_id", desactivado.id)).data).toEqual([{ id: propio.legajoId }]);
      expect((await c.from("legajo_documentos").select("id").eq("legajo_id", propio.legajoId)).data).toHaveLength(2);
      expect((await c.from("solicitudes_cambio").select("id").eq("legajo_id", propio.legajoId)).data).toEqual([
        { id: propio.solicitudId },
      ]);
      expect((await c.from("cuenta_eventos").select("tipo").eq("profile_id", desactivado.id)).data?.map((ev) => ev.tipo)).toContain(
        "desactivacion",
      );
      expect((await c.storage.from(DOCUMENTOS_BUCKET).download(propio.docPendientePath)).data).not.toBeNull();

      const actualizado = await c.from("legajos").update({ area: "Baja (prueba)" }).eq("profile_id", desactivado.id).select("area");
      expect(actualizado.error).toBeNull();
      expect(actualizado.data).toEqual([{ area: "Baja (prueba)" }]);
    });

    // Every function in the public schema, as the generated types list them:
    // a new function without an entry here fails the type check.
    type Rpc = keyof Database["public"]["Functions"];
    type Contexto = { propio: Semilla; victima: Semilla; otroInactivo: string };
    type Llamada = (c: TypedClient, x: Contexto) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
    // 42501: refused. falso / nulo: the helper answers "no" (it runs inside
    // policies, so it cannot raise). pura: a validator of its arguments only,
    // used by check constraints; it reads and writes no data.
    const RPCS: Record<Rpc, { esperado: "42501" | "falso" | "nulo" | "pura"; llamar: Llamada }> = {
      aprobar_documento: { esperado: "42501", llamar: (c, x) => c.rpc("aprobar_documento", { p_documento_id: x.victima.docPendienteId }) },
      aprobar_solicitud: { esperado: "42501", llamar: (c, x) => c.rpc("aprobar_solicitud", { p_solicitud_id: x.victima.solicitudId }) },
      campos_solicitud_permitidos: { esperado: "pura", llamar: (c) => c.rpc("campos_solicitud_permitidos") },
      cerrar_sesiones_cuenta: { esperado: "42501", llamar: (c, x) => c.rpc("cerrar_sesiones_cuenta", { p_profile_id: x.victima.id }) },
      confirmar_cambio_password: { esperado: "42501", llamar: (c) => c.rpc("confirmar_cambio_password") },
      crear_solicitud: {
        esperado: "42501",
        llamar: (c, x) =>
          c.rpc("crear_solicitud", { p_legajo_id: x.propio.legajoId, p_items: [{ campo: "nombres", valor_propuesto: "Intento" }] }),
      },
      cuenta_activa: { esperado: "falso", llamar: (c) => c.rpc("cuenta_activa") },
      current_app_role: { esperado: "nulo", llamar: (c) => c.rpc("current_app_role") },
      desactivar_cuenta: {
        esperado: "42501",
        llamar: (c, x) => c.rpc("desactivar_cuenta", { p_profile_id: x.victima.id, p_motivo: "Intento" }),
      },
      estado_documento_propio: {
        esperado: "nulo",
        llamar: (c, x) => c.rpc("estado_documento_propio", { p_storage_path: x.propio.docPendientePath }),
      },
      hay_solicitud_pendiente: {
        esperado: "42501",
        llamar: (c, x) => c.rpc("hay_solicitud_pendiente", { p_legajo_id: x.propio.legajoId }),
      },
      is_admin: { esperado: "falso", llamar: (c) => c.rpc("is_admin") },
      is_valid_hijos_json: { esperado: "pura", llamar: (c) => c.rpc("is_valid_hijos_json", { valor: "[]" }) },
      is_valid_legajo_doc_path: {
        esperado: "pura",
        llamar: (c, x) => c.rpc("is_valid_legajo_doc_path", { path: x.propio.docPendientePath }),
      },
      is_valid_solicitud_valor: {
        esperado: "pura",
        llamar: (c) => c.rpc("is_valid_solicitud_valor", { campo: "alergias", valor: "Polen" }),
      },
      marcar_password_temporal: {
        esperado: "42501",
        llamar: (c, x) => c.rpc("marcar_password_temporal", { p_profile_id: x.victima.id }),
      },
      pendientes_admin: { esperado: "42501", llamar: (c) => c.rpc("pendientes_admin") },
      purgar_cuenta: {
        esperado: "42501",
        llamar: (c, x) => c.rpc("purgar_cuenta", { p_profile_id: x.victima.id, p_email_confirmacion: x.victima.email }),
      },
      reactivar_cuenta: { esperado: "42501", llamar: (c, x) => c.rpc("reactivar_cuenta", { p_profile_id: x.otroInactivo }) },
      rechazar_documento: {
        esperado: "42501",
        llamar: (c, x) => c.rpc("rechazar_documento", { p_documento_id: x.victima.docPendienteId, p_motivo: "Intento" }),
      },
      rechazar_solicitud: {
        esperado: "42501",
        llamar: (c, x) => c.rpc("rechazar_solicitud", { p_solicitud_id: x.victima.solicitudId, p_motivo: "Intento" }),
      },
      reemplazar_documento: {
        esperado: "42501",
        llamar: (c, x) =>
          c.rpc("reemplazar_documento", {
            p_legajo_id: x.victima.legajoId,
            p_tipo: "dni_dorso",
            p_storage_path: x.victima.huerfanoPath.replace("licencia_conducir", "dni_dorso"),
            p_file_name: "intento.pdf",
            p_mime_type: "application/pdf",
            p_size_bytes: 10,
            p_conservar_historial: true,
          }),
      },
      registrar_creacion_cuenta: {
        esperado: "42501",
        llamar: (c, x) => c.rpc("registrar_creacion_cuenta", { p_profile_id: x.victima.id }),
      },
    };

    const llamantes = [
      ["a deactivated Empleado", () => desactivado, () => adminDesactivado],
      ["a deactivated Admin", () => adminDesactivado, () => desactivado],
    ] as const;

    for (const [etiqueta, quien, otro] of llamantes) {
      describe(`every function callable by authenticated, for ${etiqueta}`, () => {
        for (const [nombre, caso] of Object.entries(RPCS)) {
          it(`${nombre}: ${caso.esperado}`, async () => {
            const llamante = quien();
            const x: Contexto = {
              propio: semillas.get(llamante.id)!,
              victima: semillas.get(victima.id)!,
              otroInactivo: otro().id,
            };
            const ids = [victima.id, desactivado.id, adminDesactivado.id];
            const antes = await instantanea(service, ids);
            const { data, error } = await caso.llamar(llamante.porToken, x);
            switch (caso.esperado) {
              case "42501":
                expect(error?.code).toBe("42501");
                expect(data).toBeNull();
                break;
              case "falso":
                expect(error).toBeNull();
                expect(data).toBe(false);
                break;
              case "nulo":
                expect(error).toBeNull();
                expect(data).toBeNull();
                break;
              case "pura":
                expect(error).toBeNull();
                break;
            }
            expect(await instantanea(service, ids)).toEqual(antes);
          });
        }
      });
    }
  });
});
