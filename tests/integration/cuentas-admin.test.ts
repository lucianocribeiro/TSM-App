import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { buildDocumentoPath } from "@/lib/documentos/paths";
import { DOCUMENTOS_BUCKET } from "@/lib/documentos/tipos";
import {
  anonClient,
  createTestUser,
  deleteTestUsers,
  serviceClient,
  uniqueEmail,
  type TestUser,
  type TypedClient,
} from "./helpers";

// The Admin account module (src/lib/admin/cuentas.ts) against the local stack.
// Its session-bound server client is replaced by the signed-in test user's
// client, so the Admin check and the database functions see that user.
const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

const cuentas = await import("@/lib/admin/cuentas");

const errors = copy.cuentas.errors;
const TEMPORAL = "Temporal-2026";

describe("Admin account module", () => {
  const service = serviceClient();
  let admin: TestUser;
  let empleado: TestUser;
  // Deleted in order: accounts acted on, then the Admins who acted.
  const accountIds: string[] = [];
  const adminIds: string[] = [];

  function as(user: TestUser | null) {
    session.client = user ? user.client : anonClient();
  }

  async function signIn(email: string, password: string) {
    const client = anonClient();
    const result = await client.auth.signInWithPassword({ email, password });
    return { client, error: result.error };
  }

  async function storedProfile(id: string) {
    const { data } = await service
      .from("profiles")
      .select("role, estado_cuenta, debe_cambiar_password")
      .eq("id", id)
      .maybeSingle();
    return data;
  }

  async function eventTypes(id: string) {
    const { data } = await service.from("cuenta_eventos").select("tipo, actor_id").eq("profile_id", id).order("created_at");
    return data ?? [];
  }

  beforeAll(async () => {
    admin = await createTestUser(service, "modulo-admin", "admin");
    adminIds.push(admin.id);
    empleado = await createTestUser(service, "modulo-empleado");
    accountIds.push(empleado.id);
  });

  afterAll(async () => {
    session.client = null;
    await deleteTestUsers(service, [...accountIds, ...adminIds]);
  });

  describe("Admin check", () => {
    it.each([
      ["an Empleado", () => empleado],
      ["an anonymous caller", () => null],
    ])("refuses every action for %s, before touching anything", async (_label, who) => {
      as(who());
      const email = uniqueEmail("modulo-no-admin");
      const results = await Promise.all([
        cuentas.crearUsuario({ email, passwordTemporal: TEMPORAL, rol: "empleado" }),
        cuentas.resetPasswordTemporal({ profileId: empleado.id, passwordTemporal: TEMPORAL }),
        cuentas.desactivarCuenta({ profileId: empleado.id, motivo: "Intento" }),
        cuentas.reactivarCuenta({ profileId: empleado.id }),
        cuentas.purgarCuenta({ profileId: empleado.id, emailConfirmacion: empleado.email }),
      ]);
      for (const result of results) {
        expect(result).toEqual({ ok: false, error: errors.noAutorizado });
      }
      const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
      expect(data.users.map((user) => user.email)).not.toContain(email);
      expect(await storedProfile(empleado.id)).toMatchObject({ estado_cuenta: "activa", debe_cambiar_password: false });
      expect((await signIn(empleado.email, "IntegrationTest123!")).error).toBeNull();
    });

    it("refuses an inactive Admin", async () => {
      const inactive = await createTestUser(service, "modulo-admin-inactivo", "admin");
      accountIds.push(inactive.id);
      await service.from("profiles").update({ estado_cuenta: "inactiva" }).eq("id", inactive.id);
      as(inactive);
      expect(await cuentas.reactivarCuenta({ profileId: empleado.id })).toEqual({ ok: false, error: errors.noAutorizado });
    });
  });

  describe("crearUsuario", () => {
    it("creates a confirmed Empleado with a temporary password, the creation event and the forced change", async () => {
      as(admin);
      const email = uniqueEmail("modulo-nuevo");
      const result = await cuentas.crearUsuario({ email: `  ${email}  `, passwordTemporal: TEMPORAL, rol: "empleado" });
      expect(result.ok).toBe(true);
      const profileId = result.ok ? (result.data?.profileId ?? "") : "";
      accountIds.push(profileId);
      expect(JSON.stringify(result)).not.toContain(TEMPORAL);

      expect(await storedProfile(profileId)).toEqual({
        role: "empleado",
        estado_cuenta: "activa",
        debe_cambiar_password: true,
      });
      expect(await eventTypes(profileId)).toEqual([{ tipo: "creacion", actor_id: admin.id }]);

      const { data } = await service.auth.admin.getUserById(profileId);
      expect(data.user?.email).toBe(email);
      expect(data.user?.email_confirmed_at).toBeTruthy();
      expect((await signIn(email, TEMPORAL)).error).toBeNull();
    });

    it("creates an Admin when asked", async () => {
      as(admin);
      const result = await cuentas.crearUsuario({ email: uniqueEmail("modulo-nuevo-admin"), passwordTemporal: TEMPORAL, rol: "admin" });
      expect(result.ok).toBe(true);
      const profileId = result.ok ? (result.data?.profileId ?? "") : "";
      adminIds.unshift(profileId);
      expect((await storedProfile(profileId))?.role).toBe("admin");
    });

    it("rejects an existing email, an invalid email, a short password and an unknown role", async () => {
      as(admin);
      expect(await cuentas.crearUsuario({ email: empleado.email, passwordTemporal: TEMPORAL, rol: "empleado" })).toEqual({
        ok: false,
        error: errors.emailExistente,
      });
      expect(await cuentas.crearUsuario({ email: "no-es-email", passwordTemporal: TEMPORAL, rol: "empleado" })).toEqual({
        ok: false,
        error: errors.emailInvalido,
      });
      const shortEmail = uniqueEmail("modulo-corta");
      expect(await cuentas.crearUsuario({ email: shortEmail, passwordTemporal: "1234567", rol: "empleado" })).toEqual({
        ok: false,
        error: copy.password.errors.demasiadoCorta,
      });
      expect(
        await cuentas.crearUsuario({ email: shortEmail, passwordTemporal: TEMPORAL, rol: "jefe" as never }),
      ).toEqual({ ok: false, error: errors.rolInvalido });
      const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
      expect(data.users.map((user) => user.email)).not.toContain(shortEmail);
    });
  });

  describe("resetPasswordTemporal", () => {
    it("sets the password, flags the change, logs it and ends existing sessions", async () => {
      const target = await createTestUser(service, "modulo-reset");
      accountIds.push(target.id);
      as(admin);
      const result = await cuentas.resetPasswordTemporal({ profileId: target.id, passwordTemporal: "OtraTemporal-1" });
      expect(result).toEqual({ ok: true });

      expect((await target.client.auth.refreshSession()).error).not.toBeNull();
      expect((await signIn(target.email, "IntegrationTest123!")).error).not.toBeNull();
      expect((await signIn(target.email, "OtraTemporal-1")).error).toBeNull();
      expect((await storedProfile(target.id))?.debe_cambiar_password).toBe(true);
      expect(await eventTypes(target.id)).toEqual([{ tipo: "password_temporal", actor_id: admin.id }]);
    });

    it("rejects a short password and an unknown account", async () => {
      as(admin);
      expect(await cuentas.resetPasswordTemporal({ profileId: empleado.id, passwordTemporal: "corta" })).toEqual({
        ok: false,
        error: copy.password.errors.demasiadoCorta,
      });
      expect(await cuentas.resetPasswordTemporal({ profileId: randomUUID(), passwordTemporal: TEMPORAL })).toEqual({
        ok: false,
        error: errors.cuentaNoEncontrada,
      });
    });
  });

  describe("desactivarCuenta and reactivarCuenta", () => {
    it("deactivation bans the account and ends its sessions; reactivation lifts the ban", async () => {
      const target = await createTestUser(service, "modulo-baja");
      accountIds.push(target.id);
      as(admin);

      expect(await cuentas.desactivarCuenta({ profileId: target.id, motivo: "Baja (prueba)" })).toEqual({ ok: true });
      expect((await storedProfile(target.id))?.estado_cuenta).toBe("inactiva");
      expect((await target.client.auth.refreshSession()).error).not.toBeNull();
      const banned = await signIn(target.email, "IntegrationTest123!");
      expect(banned.error?.code).toBe("user_banned");

      expect(await cuentas.desactivarCuenta({ profileId: target.id, motivo: "Otra vez" })).toEqual({
        ok: false,
        error: errors.yaInactiva,
      });

      expect(await cuentas.reactivarCuenta({ profileId: target.id })).toEqual({ ok: true });
      expect((await storedProfile(target.id))?.estado_cuenta).toBe("activa");
      expect((await signIn(target.email, "IntegrationTest123!")).error).toBeNull();
      expect(await cuentas.reactivarCuenta({ profileId: target.id })).toEqual({ ok: false, error: errors.yaActiva });

      expect((await eventTypes(target.id)).map((event) => event.tipo)).toEqual(["desactivacion", "reactivacion"]);
    });

    it("refuses the caller's own account and a blank reason", async () => {
      as(admin);
      expect(await cuentas.desactivarCuenta({ profileId: admin.id, motivo: "Yo" })).toEqual({
        ok: false,
        error: errors.cuentaPropia,
      });
      expect(await cuentas.desactivarCuenta({ profileId: empleado.id, motivo: "  " })).toEqual({
        ok: false,
        error: errors.motivoRequerido,
      });
      expect((await storedProfile(empleado.id))?.estado_cuenta).toBe("activa");
    });
  });

  describe("purgarCuenta", () => {
    // An Empleado with every kind of row the purge must remove.
    async function cuentaCompleta(label: string) {
      const user = await createTestUser(service, label);
      accountIds.push(user.id);
      const { data: legajo } = await service.from("legajos").select("id").eq("profile_id", user.id).single();
      const legajoId = legajo?.id ?? "";

      await service.from("legajos").update({ nombres: "Purga (prueba)", alergias: "Ninguna" }).eq("id", legajoId);
      await service.from("legajo_hijos").insert({ legajo_id: legajoId, nombre_completo: "Hijo (prueba)", fecha_nacimiento: "2018-01-01" });

      const path = buildDocumentoPath({ profileId: user.id, tipo: "dni_frente", fileId: randomUUID(), mimeType: "application/pdf" }) ?? "";
      const body = Buffer.from("%PDF-1.4\n% FAKE TEST FILE - purge\n%%EOF\n");
      expect((await user.client.storage.from(DOCUMENTOS_BUCKET).upload(path, body, { contentType: "application/pdf" })).error).toBeNull();
      const doc = await user.client.from("legajo_documentos").insert({
        legajo_id: legajoId,
        tipo: "dni_frente",
        storage_path: path,
        file_name: "dni.pdf",
        mime_type: "application/pdf",
        size_bytes: body.length,
        uploaded_by: user.id,
      });
      expect(doc.error).toBeNull();
      // An orphan object from a failed upload.
      const orphan = buildDocumentoPath({ profileId: user.id, tipo: "dni_dorso", fileId: randomUUID(), mimeType: "application/pdf" }) ?? "";
      expect((await user.client.storage.from(DOCUMENTOS_BUCKET).upload(orphan, body, { contentType: "application/pdf" })).error).toBeNull();

      const solicitud = await user.client.rpc("crear_solicitud", {
        p_legajo_id: legajoId,
        p_items: [{ campo: "alergias", valor_propuesto: "Polen" }],
      });
      expect(solicitud.error).toBeNull();

      expect((await admin.client.rpc("registrar_creacion_cuenta", { p_profile_id: user.id })).error).toBeNull();
      return { user, legajoId, paths: [path, orphan], solicitudId: solicitud.data ?? "" };
    }

    async function remaining(client: TypedClient, profileId: string, legajoId: string, solicitudId: string) {
      const count = async (table: "profiles" | "legajos" | "legajo_hijos" | "legajo_documentos" | "solicitudes_cambio" | "solicitudes_cambio_items" | "cuenta_eventos", column: string, value: string) => {
        const { count: n } = await client.from(table).select("id", { count: "exact", head: true }).eq(column, value);
        return n ?? 0;
      };
      const objects = await client.storage.from(DOCUMENTOS_BUCKET).list(`${profileId}/dni_frente`);
      const orphans = await client.storage.from(DOCUMENTOS_BUCKET).list(`${profileId}/dni_dorso`);
      return {
        profiles: await count("profiles", "id", profileId),
        legajos: await count("legajos", "id", legajoId),
        hijos: await count("legajo_hijos", "legajo_id", legajoId),
        documentos: await count("legajo_documentos", "legajo_id", legajoId),
        solicitudes: await count("solicitudes_cambio", "legajo_id", legajoId),
        items: await count("solicitudes_cambio_items", "solicitud_id", solicitudId),
        eventos: await count("cuenta_eventos", "profile_id", profileId),
        objetos: (objects.data?.length ?? 0) + (orphans.data?.length ?? 0),
      };
    }

    it("does nothing when the confirmation email does not match exactly", async () => {
      const { user, legajoId, solicitudId } = await cuentaCompleta("modulo-purga-no");
      as(admin);
      const before = await remaining(service, user.id, legajoId, solicitudId);
      for (const emailConfirmacion of ["otro@mitsm.test", user.email.toUpperCase(), ` ${user.email}`, ""]) {
        expect(await cuentas.purgarCuenta({ profileId: user.id, emailConfirmacion })).toEqual({
          ok: false,
          error: errors.emailConfirmacionNoCoincide,
        });
      }
      expect(await remaining(service, user.id, legajoId, solicitudId)).toEqual(before);
      expect(before).toEqual({ profiles: 1, legajos: 1, hijos: 1, documentos: 1, solicitudes: 1, items: 1, eventos: 1, objetos: 2 });
      expect((await service.auth.admin.getUserById(user.id)).data.user?.id).toBe(user.id);
    });

    it("removes the auth user, profile, legajo, children, documents, requests, events and files", async () => {
      const { user, legajoId, solicitudId, paths } = await cuentaCompleta("modulo-purga-si");
      as(admin);
      const result = await cuentas.purgarCuenta({ profileId: user.id, emailConfirmacion: user.email });
      expect(result).toEqual({
        ok: true,
        data: { objetos: 2, documentos: 1, hijos: 1, solicitudes: 1, eventos: 1 },
      });

      expect((await service.auth.admin.getUserById(user.id)).data.user).toBeNull();
      expect(await remaining(service, user.id, legajoId, solicitudId)).toEqual({
        profiles: 0,
        legajos: 0,
        hijos: 0,
        documentos: 0,
        solicitudes: 0,
        items: 0,
        eventos: 0,
        objetos: 0,
      });
      for (const path of paths) {
        expect((await service.storage.from(DOCUMENTOS_BUCKET).download(path)).data).toBeNull();
      }
    });

    it("refuses the caller's own account", async () => {
      as(admin);
      expect(await cuentas.purgarCuenta({ profileId: admin.id, emailConfirmacion: admin.email })).toEqual({
        ok: false,
        error: errors.cuentaPropia,
      });
    });

    it("refuses an account named in other accounts' history", async () => {
      const reviewer = await createTestUser(service, "modulo-revisor", "admin");
      adminIds.unshift(reviewer.id);
      const { user } = await cuentaCompleta("modulo-historial");
      // The reviewer acts on another account.
      expect((await reviewer.client.rpc("marcar_password_temporal", { p_profile_id: user.id })).error).toBeNull();

      as(admin);
      expect(await cuentas.purgarCuenta({ profileId: reviewer.id, emailConfirmacion: reviewer.email })).toEqual({
        ok: false,
        error: errors.historialEnOtrasCuentas,
      });
      expect((await service.auth.admin.getUserById(reviewer.id)).data.user?.id).toBe(reviewer.id);
    });

    it("refuses an unknown account", async () => {
      as(admin);
      expect(await cuentas.purgarCuenta({ profileId: randomUUID(), emailConfirmacion: "x@mitsm.test" })).toEqual({
        ok: false,
        error: errors.cuentaNoEncontrada,
      });
    });
  });
});
