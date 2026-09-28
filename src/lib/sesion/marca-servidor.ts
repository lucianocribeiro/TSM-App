import "server-only";
import { cookies, headers } from "next/headers";
import { getServerEnv } from "@/lib/env";
import { claveMarca, firmarMarca, MARCA_COOKIE, opcionesMarca } from "./marca";

// Setting and clearing the activity marker from a Server Action (after
// sign-in, after a password change, on sign-out). The proxy re-stamps it on
// later requests (src/lib/supabase/middleware.ts).

async function esHttps(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  const origin = h.get("origin");
  if (origin) {
    try {
      return new URL(origin).protocol === "https:";
    } catch {
      return process.env.NODE_ENV === "production";
    }
  }
  return process.env.NODE_ENV === "production";
}

export async function sellarActividad(sesionId: string): Promise<void> {
  const clave = await claveMarca(getServerEnv().supabaseServiceRoleKey);
  const valor = await firmarMarca(clave, sesionId, Date.now());
  (await cookies()).set(MARCA_COOKIE, valor, opcionesMarca(await esHttps()));
}

export async function borrarActividad(): Promise<void> {
  (await cookies()).delete(MARCA_COOKIE);
}
