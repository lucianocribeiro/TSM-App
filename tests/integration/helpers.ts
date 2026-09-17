import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

// Test helpers for the local Supabase stack only.

export type TypedClient = SupabaseClient<Database>;

export type TestUser = {
  id: string;
  email: string;
  client: TypedClient;
};

const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false },
};

export const TEST_PASSWORD = "IntegrationTest123!";

export function serviceClient(): TypedClient {
  const { supabaseUrl, supabaseServiceRoleKey } = getServerEnv();
  return createClient<Database>(supabaseUrl, supabaseServiceRoleKey, clientOptions);
}

export function anonClient(): TypedClient {
  const { supabaseUrl, supabaseAnonKey } = getServerEnv();
  return createClient<Database>(supabaseUrl, supabaseAnonKey, clientOptions);
}

export function uniqueEmail(label: string): string {
  return `${label}.${randomUUID()}@mitsm.test`;
}

// Creates a confirmed user with the service-role client and returns a client
// signed in as that user. Setup only; assertions use the returned client.
export async function createTestUser(
  service: TypedClient,
  label: string,
  role: Database["public"]["Enums"]["app_role"] = "empleado",
): Promise<TestUser> {
  const email = uniqueEmail(label);
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createUser failed for ${label}: ${error?.message}`);
  }
  const id = data.user.id;

  if (role !== "empleado") {
    const { error: roleError } = await service
      .from("profiles")
      .update({ role })
      .eq("id", id);
    if (roleError) {
      throw new Error(`role setup failed for ${label}: ${roleError.message}`);
    }
  }

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError) {
    throw new Error(`sign-in failed for ${label}: ${signInError.message}`);
  }

  return { id, email, client };
}

export async function deleteTestUsers(
  service: TypedClient,
  ids: string[],
): Promise<void> {
  for (const id of ids) {
    await service.auth.admin.deleteUser(id);
  }
}
