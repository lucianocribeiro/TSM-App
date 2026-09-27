import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

// Service-role setup for e2e tests, against the LOCAL stack only. It refuses to
// run when the Supabase URL is not local, so a misconfigured environment can
// never reach the remote project.

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export const E2E_PASSWORD = "E2eTestPass123!";

export function localServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
    throw new Error("e2e service setup runs against the local Supabase stack only.");
  }
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for e2e setup.");
  return createClient<Database>(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// A confirmed user for one test (Empleado unless asked). Delete it with deleteE2EUser.
export async function createE2EUser(label: string, role: Database["public"]["Enums"]["app_role"] = "empleado") {
  const service = localServiceClient();
  const email = `e2e.${label}.${randomUUID()}@mitsm.test`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: E2E_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`e2e user setup failed: ${error?.message}`);
  if (role !== "empleado") {
    const promoted = await service.from("profiles").update({ role }).eq("id", data.user.id);
    if (promoted.error) throw new Error(`e2e role setup failed: ${promoted.error.message}`);
  }
  return { id: data.user.id, email, password: E2E_PASSWORD };
}

export async function deleteE2EUser(id: string) {
  await localServiceClient().auth.admin.deleteUser(id);
}

// Deletes an account created through the UI, found by its email.
export async function deleteE2EUserByEmail(email: string) {
  const service = localServiceClient();
  const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
  const user = data?.users.find((candidate) => candidate.email === email);
  if (user) await service.auth.admin.deleteUser(user.id);
}

// Fills a throwaway user's legajo (local stack only).
export async function fillLegajo(profileId: string, values: Database["public"]["Tables"]["legajos"]["Update"]) {
  const { error } = await localServiceClient().from("legajos").update(values).eq("profile_id", profileId);
  if (error) throw new Error(`legajo setup failed: ${error.message}`);
}

// The seed Admin's session (local stack only), to decide requests the way an
// Admin does: the decision functions check auth.uid(), not the service role.
export async function seedAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
    throw new Error("e2e service setup runs against the local Supabase stack only.");
  }
  const client = createClient<Database>(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: "admin@mitsm.test", password: "TestPass123!" });
  if (error) throw new Error(`seed admin sign-in failed: ${error.message}`);
  return client;
}

// The id of the latest change request of a user's legajo.
export async function ultimaSolicitud(profileId: string) {
  const service = localServiceClient();
  const { data } = await service
    .from("solicitudes_cambio")
    .select("id, estado, legajos!inner(profile_id)")
    .eq("legajos.profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data;
}
