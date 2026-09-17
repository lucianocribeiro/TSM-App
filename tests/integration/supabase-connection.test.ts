import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getServerEnv } from "@/lib/env";

// Runs against the local Supabase stack only (`supabase start`).
describe("local Supabase stack", () => {
  const { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey } = getServerEnv();

  it("points at a local instance", () => {
    const { hostname } = new URL(supabaseUrl);
    expect(["127.0.0.1", "localhost"]).toContain(hostname);
  });

  it("reaches the auth service with the anon key", async () => {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: supabaseAnonKey },
    });
    expect(res.status).toBe(200);
  });

  it("authenticates with the service role key", async () => {
    const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1 });
    expect(error).toBeNull();
    expect(Array.isArray(data.users)).toBe(true);
  });
});
