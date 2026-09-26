import { describe, expect, it } from "vitest";
import { anonClient } from "./helpers";

// Verifies the local seed (supabase/seed.sql): test users sign in with email +
// password and carry the expected roles. Local and CI test data only.
const SEED_PASSWORD = "TestPass123!";

const seedUsers = [
  { email: "admin@mitsm.test", role: "admin" },
  { email: "empleado.a@mitsm.test", role: "empleado" },
  { email: "empleado.b@mitsm.test", role: "empleado" },
] as const;

describe("local seed users", () => {
  for (const { email, role } of seedUsers) {
    it(`${email} signs in with role ${role}`, async () => {
      const client = anonClient();
      const { error } = await client.auth.signInWithPassword({
        email,
        password: SEED_PASSWORD,
      });
      expect(error).toBeNull();

      const { data, error: rpcError } = await client.rpc("current_app_role");
      expect(rpcError).toBeNull();
      expect(data).toBe(role);

      await client.auth.signOut();
    });
  }
});

describe("local seed documents", () => {
  async function signIn(email: string) {
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
    expect(error).toBeNull();
    return client;
  }

  it("Empleado A has DNI frente and dorso with readable fake files", async () => {
    const client = await signIn("empleado.a@mitsm.test");
    const { data, error } = await client
      .from("legajo_documentos")
      .select("tipo, storage_path, size_bytes")
      .order("tipo");
    expect(error).toBeNull();
    expect(data?.map((row) => row.tipo)).toEqual(["dni_frente", "dni_dorso"]);

    for (const row of data ?? []) {
      const file = await client.storage.from("legajo-docs").download(row.storage_path);
      expect(file.error, row.tipo).toBeNull();
      const text = (await file.data?.text()) ?? "";
      expect(text, row.tipo).toContain("FAKE TEST FILE");
      expect(file.data?.size, row.tipo).toBe(row.size_bytes);
    }
    await client.auth.signOut();
  });

  it("Empleado B has no documents", async () => {
    const client = await signIn("empleado.b@mitsm.test");
    const { data, error } = await client.from("legajo_documentos").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    await client.auth.signOut();
  });
});
