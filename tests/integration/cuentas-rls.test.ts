import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  createTestUser,
  deleteTestUsers,
  serviceClient,
  type TestUser,
} from "./helpers";

// F1-07A: account state, forced password change and account history
// (Constitution §10, PRD US-8 and US-9). Assertions run through user sessions;
// the service-role client is used for setup and for reading back stored state.

const PERMISSION_DENIED = "42501";
const INVALID_PARAMETER = "22023";
const NOT_FOUND = "P0002";
const BUSINESS_RULE = "55000";

describe("account functions, profile columns and cuenta_eventos", () => {
  const service = serviceClient();
  let admin: TestUser;
  let empleado: TestUser;
  let otro: TestUser;
  // Deleted in order: accounts acted on before the Admins who acted on them
  // (cuenta_eventos.actor_id keeps an actor while their events on others exist).
  // Admins go newest first: a later Admin may be the target of an earlier one.
  const employeeIds: string[] = [];
  const adminIds: string[] = [];

  async function newEmpleado(label: string): Promise<TestUser> {
    const user = await createTestUser(service, label);
    employeeIds.push(user.id);
    return user;
  }

  async function newAdmin(label: string): Promise<TestUser> {
    const user = await createTestUser(service, label, "admin");
    adminIds.push(user.id);
    return user;
  }

  async function storedProfile(id: string) {
    const { data, error } = await service
      .from("profiles")
      .select("role, estado_cuenta, debe_cambiar_password")
      .eq("id", id)
      .single();
    expect(error).toBeNull();
    if (!data) throw new Error("profile not found");
    return data;
  }

  async function eventsOf(id: string) {
    const { data, error } = await service
      .from("cuenta_eventos")
      .select("tipo, motivo, actor_id")
      .eq("profile_id", id)
      .order("created_at");
    expect(error).toBeNull();
    return data ?? [];
  }

  beforeAll(async () => {
    admin = await newAdmin("cuentas-admin");
    empleado = await newEmpleado("cuentas-empleado");
    otro = await newEmpleado("cuentas-otro");
  });

  afterAll(async () => {
    await deleteTestUsers(service, [...employeeIds, ...[...adminIds].reverse()]);
  });

  describe("profile columns", () => {
    it("default to an active account with no pending password change", async () => {
      expect(await storedProfile(empleado.id)).toMatchObject({
        estado_cuenta: "activa",
        debe_cambiar_password: false,
      });
    });

    it("cannot be changed by direct UPDATE, by an Empleado or an Admin, on any profile", async () => {
      const attempts = [
        [empleado, empleado.id],
        [empleado, otro.id],
        [admin, empleado.id],
        [admin, admin.id],
      ] as const;
      for (const [user, target] of attempts) {
        for (const update of [{ estado_cuenta: "inactiva" as const }, { debe_cambiar_password: true }]) {
          const { data, error } = await user.client.from("profiles").update(update).eq("id", target).select();
          expect(data, `${user.email} -> ${target} ${JSON.stringify(update)}`).toBeNull();
          expect(error?.code).toBe(PERMISSION_DENIED);
        }
      }
      expect(await storedProfile(empleado.id)).toMatchObject({ estado_cuenta: "activa", debe_cambiar_password: false });
      expect(await storedProfile(otro.id)).toMatchObject({ estado_cuenta: "activa", debe_cambiar_password: false });
    });
  });

  describe("desactivar_cuenta", () => {
    it("is Admin only", async () => {
      const { error } = await empleado.client.rpc("desactivar_cuenta", { p_profile_id: otro.id, p_motivo: "Intento" });
      expect(error?.code).toBe(PERMISSION_DENIED);
      expect((await storedProfile(otro.id)).estado_cuenta).toBe("activa");
    });

    it("requires a non-blank reason", async () => {
      for (const motivo of ["", "   ", "\t\n"]) {
        const { error } = await admin.client.rpc("desactivar_cuenta", { p_profile_id: otro.id, p_motivo: motivo });
        expect(error?.code, JSON.stringify(motivo)).toBe(INVALID_PARAMETER);
      }
      expect((await storedProfile(otro.id)).estado_cuenta).toBe("activa");
    });

    it("cannot target the caller's own account", async () => {
      const { error } = await admin.client.rpc("desactivar_cuenta", { p_profile_id: admin.id, p_motivo: "Yo mismo" });
      expect(error?.code).toBe(BUSINESS_RULE);
      expect(error?.hint).toBe("cuenta_propia");
      expect((await storedProfile(admin.id)).estado_cuenta).toBe("activa");
    });

    it("fails for an account that does not exist", async () => {
      const { error } = await admin.client.rpc("desactivar_cuenta", { p_profile_id: randomUUID(), p_motivo: "x" });
      expect(error?.code).toBe(NOT_FOUND);
    });

    it("deactivates, logs the event with the trimmed reason and ends the account's sessions", async () => {
      const target = await newEmpleado("cuentas-desactivar");
      const { error } = await admin.client.rpc("desactivar_cuenta", {
        p_profile_id: target.id,
        p_motivo: "  Fin del contrato (prueba)  ",
      });
      expect(error).toBeNull();

      expect((await storedProfile(target.id)).estado_cuenta).toBe("inactiva");
      expect(await eventsOf(target.id)).toEqual([
        { tipo: "desactivacion", motivo: "Fin del contrato (prueba)", actor_id: admin.id },
      ]);

      const refreshed = await target.client.auth.refreshSession();
      expect(refreshed.error).not.toBeNull();
    });

    it("fails for an account that is already inactive", async () => {
      const target = await newEmpleado("cuentas-ya-inactiva");
      expect((await admin.client.rpc("desactivar_cuenta", { p_profile_id: target.id, p_motivo: "Primera" })).error).toBeNull();
      const again = await admin.client.rpc("desactivar_cuenta", { p_profile_id: target.id, p_motivo: "Segunda" });
      expect(again.error?.code).toBe(BUSINESS_RULE);
      expect(again.error?.hint).toBe("ya_inactiva");
      expect(await eventsOf(target.id)).toHaveLength(1);
    });

    // The last-admin rule: the caller must be an active Admin (is_admin) and
    // cannot target themselves, so the last active Admin is never reachable.
    // This test shows the pieces: an Admin can deactivate another Admin, the
    // deactivated Admin loses Admin rights at once, and the one left cannot
    // deactivate themselves.
    it("never leaves the system without an active Admin", async () => {
      const adminA = await newAdmin("cuentas-admin-a");
      const adminB = await newAdmin("cuentas-admin-b");

      expect((await adminA.client.rpc("desactivar_cuenta", { p_profile_id: adminB.id, p_motivo: "Rotación" })).error).toBeNull();
      expect((await storedProfile(adminB.id)).estado_cuenta).toBe("inactiva");

      // adminB's access token has not expired, but is_admin() is false now.
      const { data: isAdmin } = await adminB.client.rpc("is_admin");
      expect(isAdmin).toBe(false);
      const back = await adminB.client.rpc("desactivar_cuenta", { p_profile_id: adminA.id, p_motivo: "Venganza" });
      expect(back.error?.code).toBe(PERMISSION_DENIED);
      expect((await storedProfile(adminA.id)).estado_cuenta).toBe("activa");

      const self = await adminA.client.rpc("desactivar_cuenta", { p_profile_id: adminA.id, p_motivo: "Yo" });
      expect(self.error?.hint).toBe("cuenta_propia");
      expect((await storedProfile(adminA.id)).estado_cuenta).toBe("activa");
    });
  });

  describe("reactivar_cuenta", () => {
    it("is Admin only, reactivates, logs the event, and fails for an active account", async () => {
      const target = await newEmpleado("cuentas-reactivar");
      await admin.client.rpc("desactivar_cuenta", { p_profile_id: target.id, p_motivo: "Licencia (prueba)" });

      const byEmpleado = await empleado.client.rpc("reactivar_cuenta", { p_profile_id: target.id });
      expect(byEmpleado.error?.code).toBe(PERMISSION_DENIED);
      expect((await storedProfile(target.id)).estado_cuenta).toBe("inactiva");

      expect((await admin.client.rpc("reactivar_cuenta", { p_profile_id: target.id })).error).toBeNull();
      expect((await storedProfile(target.id)).estado_cuenta).toBe("activa");
      expect((await eventsOf(target.id)).map((event) => [event.tipo, event.motivo, event.actor_id])).toEqual([
        ["desactivacion", "Licencia (prueba)", admin.id],
        ["reactivacion", null, admin.id],
      ]);

      const again = await admin.client.rpc("reactivar_cuenta", { p_profile_id: target.id });
      expect(again.error?.code).toBe(BUSINESS_RULE);
      expect(again.error?.hint).toBe("ya_activa");

      const missing = await admin.client.rpc("reactivar_cuenta", { p_profile_id: randomUUID() });
      expect(missing.error?.code).toBe(NOT_FOUND);
    });
  });

  describe("temporary password and forced change", () => {
    it("registrar_creacion_cuenta is Admin only; logs the creation and flags the change", async () => {
      const target = await newEmpleado("cuentas-creacion");
      const byEmpleado = await empleado.client.rpc("registrar_creacion_cuenta", { p_profile_id: target.id });
      expect(byEmpleado.error?.code).toBe(PERMISSION_DENIED);

      expect((await admin.client.rpc("registrar_creacion_cuenta", { p_profile_id: target.id })).error).toBeNull();
      expect((await storedProfile(target.id)).debe_cambiar_password).toBe(true);
      expect(await eventsOf(target.id)).toEqual([{ tipo: "creacion", motivo: null, actor_id: admin.id }]);
    });

    it("marcar_password_temporal is Admin only: an Empleado cannot mark their own or someone else's", async () => {
      for (const target of [empleado.id, otro.id]) {
        const { error } = await empleado.client.rpc("marcar_password_temporal", { p_profile_id: target });
        expect(error?.code).toBe(PERMISSION_DENIED);
        expect((await storedProfile(target)).debe_cambiar_password).toBe(false);
      }
      const missing = await admin.client.rpc("marcar_password_temporal", { p_profile_id: randomUUID() });
      expect(missing.error?.code).toBe(NOT_FOUND);
    });

    it("marcar_password_temporal flags the change, logs it and ends the account's sessions", async () => {
      const target = await newEmpleado("cuentas-temporal");
      expect((await admin.client.rpc("marcar_password_temporal", { p_profile_id: target.id })).error).toBeNull();
      expect((await storedProfile(target.id)).debe_cambiar_password).toBe(true);
      expect(await eventsOf(target.id)).toEqual([{ tipo: "password_temporal", motivo: null, actor_id: admin.id }]);
      expect((await target.client.auth.refreshSession()).error).not.toBeNull();
    });

    it("confirmar_cambio_password clears only the caller's own flag and logs it as their own action", async () => {
      const target = await newEmpleado("cuentas-confirmar");
      const bystander = await newEmpleado("cuentas-confirmar-otro");
      for (const user of [target, bystander]) {
        await admin.client.rpc("registrar_creacion_cuenta", { p_profile_id: user.id });
      }
      // registrar_creacion_cuenta does not end sessions, so the clients still work.
      expect((await target.client.rpc("confirmar_cambio_password")).error).toBeNull();

      expect((await storedProfile(target.id)).debe_cambiar_password).toBe(false);
      expect((await storedProfile(bystander.id)).debe_cambiar_password).toBe(true);
      expect((await eventsOf(target.id)).map((event) => [event.tipo, event.actor_id])).toEqual([
        ["creacion", admin.id],
        ["password_cambiada", target.id],
      ]);
      expect((await eventsOf(bystander.id)).map((event) => event.tipo)).toEqual(["creacion"]);
    });
  });

  describe("cuenta_eventos", () => {
    it("an Empleado reads only their own events; an Admin reads all", async () => {
      const target = await newEmpleado("cuentas-eventos");
      await admin.client.rpc("registrar_creacion_cuenta", { p_profile_id: target.id });
      await admin.client.rpc("registrar_creacion_cuenta", { p_profile_id: otro.id });

      const own = await target.client.from("cuenta_eventos").select("profile_id, tipo");
      expect(own.error).toBeNull();
      expect(own.data).toEqual([{ profile_id: target.id, tipo: "creacion" }]);

      const others = await target.client.from("cuenta_eventos").select("id").eq("profile_id", otro.id);
      expect(others.data).toEqual([]);

      const all = await admin.client.from("cuenta_eventos").select("profile_id").in("profile_id", [target.id, otro.id]);
      expect(all.data?.map((row) => row.profile_id).sort()).toEqual([target.id, otro.id].sort());
    });

    it("nobody inserts, updates or deletes events directly", async () => {
      await admin.client.rpc("marcar_password_temporal", { p_profile_id: otro.id });
      const [event] = await service.from("cuenta_eventos").select("id").eq("profile_id", otro.id).limit(1).then((r) => r.data ?? []);
      expect(event).toBeDefined();

      for (const user of [empleado, otro, admin]) {
        const insert = await user.client
          .from("cuenta_eventos")
          .insert({ profile_id: user.id, tipo: "reactivacion", actor_id: user.id })
          .select();
        expect(insert.error?.code, user.email).toBe(PERMISSION_DENIED);

        const update = await user.client.from("cuenta_eventos").update({ motivo: "x" }).eq("id", event.id).select();
        expect(update.error?.code, user.email).toBe(PERMISSION_DENIED);

        const del = await user.client.from("cuenta_eventos").delete().eq("id", event.id).select();
        expect(del.error?.code, user.email).toBe(PERMISSION_DENIED);
      }
      const { count } = await service.from("cuenta_eventos").select("id", { count: "exact", head: true }).eq("id", event.id);
      expect(count).toBe(1);
    });

    it("rejects a deactivation without a reason and a reason on any other event", async () => {
      const bad = [
        { tipo: "desactivacion" as const, motivo: null },
        { tipo: "desactivacion" as const, motivo: "  " },
        { tipo: "creacion" as const, motivo: "No corresponde" },
      ];
      for (const row of bad) {
        const { error } = await service
          .from("cuenta_eventos")
          .insert({ profile_id: otro.id, actor_id: admin.id, ...row });
        expect(error?.code, JSON.stringify(row)).toBe("23514");
      }
    });
  });

  describe("anonymous", () => {
    it("has no access to cuenta_eventos", async () => {
      const anon = anonClient();
      const select = await anon.from("cuenta_eventos").select("*");
      expect(select.data).toBeNull();
      expect(select.error?.code).toBe(PERMISSION_DENIED);
      const insert = await anon.from("cuenta_eventos").insert({ profile_id: empleado.id, tipo: "creacion", actor_id: empleado.id });
      expect(insert.error?.code).toBe(PERMISSION_DENIED);
    });

    it("cannot call the account functions", async () => {
      const anon = anonClient();
      const calls = await Promise.all([
        anon.rpc("desactivar_cuenta", { p_profile_id: empleado.id, p_motivo: "x" }),
        anon.rpc("reactivar_cuenta", { p_profile_id: empleado.id }),
        anon.rpc("marcar_password_temporal", { p_profile_id: empleado.id }),
        anon.rpc("confirmar_cambio_password"),
        anon.rpc("registrar_creacion_cuenta", { p_profile_id: empleado.id }),
        anon.rpc("cerrar_sesiones_cuenta", { p_profile_id: empleado.id }),
      ]);
      for (const result of calls) {
        expect(result.data).toBeNull();
        expect(result.error?.code).toBe(PERMISSION_DENIED);
      }
    });

    it("cerrar_sesiones_cuenta is internal: authenticated users cannot call it either", async () => {
      for (const user of [empleado, admin]) {
        const { error } = await user.client.rpc("cerrar_sesiones_cuenta", { p_profile_id: otro.id });
        expect(error?.code, user.email).toBe(PERMISSION_DENIED);
      }
    });
  });
});
