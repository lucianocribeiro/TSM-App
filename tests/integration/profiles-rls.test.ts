import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  createTestUser,
  deleteTestUsers,
  serviceClient,
  TEST_PASSWORD,
  uniqueEmail,
  type TestUser,
} from "./helpers";

// RLS and role boundaries for public.profiles and the role helper functions.
// Runs against the local Supabase stack only (`supabase start`).

const PERMISSION_DENIED = "42501";

describe("profiles RLS and role helpers", () => {
  const service = serviceClient();
  let empleadoA: TestUser;
  let empleadoB: TestUser;
  let admin: TestUser;
  const createdIds: string[] = [];

  async function roleOf(id: string) {
    const { data, error } = await service
      .from("profiles")
      .select("role")
      .eq("id", id)
      .single();
    expect(error).toBeNull();
    return data?.role;
  }

  beforeAll(async () => {
    empleadoA = await createTestUser(service, "empleado-a");
    empleadoB = await createTestUser(service, "empleado-b");
    admin = await createTestUser(service, "admin", "admin");
    createdIds.push(empleadoA.id, empleadoB.id, admin.id);
  });

  afterAll(async () => {
    await deleteTestUsers(service, createdIds);
  });

  describe("anonymous", () => {
    it("cannot read profiles", async () => {
      const { data, error } = await anonClient().from("profiles").select("*");
      expect(data).toBeNull();
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("cannot call current_app_role", async () => {
      const { data, error } = await anonClient().rpc("current_app_role");
      expect(data).toBeNull();
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("cannot call is_admin", async () => {
      const { data, error } = await anonClient().rpc("is_admin");
      expect(data).toBeNull();
      expect(error?.code).toBe(PERMISSION_DENIED);
    });
  });

  describe("empleado reads", () => {
    it("reading all profiles returns only the own row", async () => {
      const { data, error } = await empleadoA.client.from("profiles").select("*");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.id).toBe(empleadoA.id);
      expect(data?.[0]?.role).toBe("empleado");
    });

    it("cannot read another empleado's profile by id", async () => {
      const { data, error } = await empleadoA.client
        .from("profiles")
        .select("*")
        .eq("id", empleadoB.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  describe("empleado writes", () => {
    it("cannot update own role to admin", async () => {
      const { data, error } = await empleadoA.client
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", empleadoA.id)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect(await roleOf(empleadoA.id)).toBe("empleado");
    });

    it("cannot update another empleado's profile", async () => {
      const { data, error } = await empleadoA.client
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", empleadoB.id)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect(await roleOf(empleadoB.id)).toBe("empleado");
    });

    it("cannot insert a profile", async () => {
      const { data, error } = await empleadoA.client
        .from("profiles")
        .insert({ id: empleadoA.id, role: "admin" })
        .select();
      expect(data).toBeNull();
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("cannot delete own or another profile", async () => {
      for (const id of [empleadoA.id, empleadoB.id]) {
        const { data, error } = await empleadoA.client
          .from("profiles")
          .delete()
          .eq("id", id)
          .select();
        expect(data).toBeNull();
        expect(error?.code).toBe(PERMISSION_DENIED);
        expect(await roleOf(id)).toBe("empleado");
      }
    });
  });

  describe("admin", () => {
    it("reads all profiles", async () => {
      const { data, error } = await admin.client.from("profiles").select("id");
      expect(error).toBeNull();
      const ids = (data ?? []).map((row) => row.id);
      expect(ids).toEqual(
        expect.arrayContaining([empleadoA.id, empleadoB.id, admin.id]),
      );
    });

    it("can change an empleado's role and updated_at is maintained", async () => {
      const target = await createTestUser(service, "empleado-promoted");
      createdIds.push(target.id);

      const { data: before } = await service
        .from("profiles")
        .select("updated_at")
        .eq("id", target.id)
        .single();

      const { data, error } = await admin.client
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", target.id)
        .select();
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.role).toBe("admin");
      expect(await roleOf(target.id)).toBe("admin");
      expect(new Date(data?.[0]?.updated_at ?? 0).getTime()).toBeGreaterThan(
        new Date(before?.updated_at ?? 0).getTime(),
      );
    });
  });

  describe("role helpers", () => {
    it("return empleado / false for an empleado session", async () => {
      const role = await empleadoA.client.rpc("current_app_role");
      expect(role.error).toBeNull();
      expect(role.data).toBe("empleado");

      const isAdmin = await empleadoA.client.rpc("is_admin");
      expect(isAdmin.error).toBeNull();
      expect(isAdmin.data).toBe(false);
    });

    it("return admin / true for an admin session", async () => {
      const role = await admin.client.rpc("current_app_role");
      expect(role.error).toBeNull();
      expect(role.data).toBe("admin");

      const isAdmin = await admin.client.rpc("is_admin");
      expect(isAdmin.error).toBeNull();
      expect(isAdmin.data).toBe(true);
    });
  });

  describe("profile creation trigger", () => {
    it("creates an empleado profile even when metadata asks for admin", async () => {
      const { data, error } = await service.auth.admin.createUser({
        email: uniqueEmail("metadata-admin"),
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { role: "admin" },
        app_metadata: { role: "admin" },
      });
      expect(error).toBeNull();
      const id = data.user?.id;
      expect(id).toBeDefined();
      if (!id) return;
      createdIds.push(id);

      expect(await roleOf(id)).toBe("empleado");
    });

    it("rejects public sign-up", async () => {
      const email = uniqueEmail("public-signup");
      const { data, error } = await anonClient().auth.signUp({
        email,
        password: TEST_PASSWORD,
        options: { data: { role: "admin" } },
      });
      expect(data.user).toBeNull();
      expect(error?.code).toBe("signup_disabled");
    });
  });
});
