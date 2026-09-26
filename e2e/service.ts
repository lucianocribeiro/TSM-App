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

// A confirmed Empleado for one test. Delete it with deleteE2EUser.
export async function createE2EUser(label: string) {
  const service = localServiceClient();
  const email = `e2e.${label}.${randomUUID()}@mitsm.test`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: E2E_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`e2e user setup failed: ${error?.message}`);
  return { id: data.user.id, email, password: E2E_PASSWORD };
}

export async function deleteE2EUser(id: string) {
  await localServiceClient().auth.admin.deleteUser(id);
}
