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
