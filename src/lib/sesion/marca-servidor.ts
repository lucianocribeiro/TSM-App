import "server-only";
import { cookies, headers } from "next/headers";
import { claveMarcaEntorno, firmarMarca, MARCA_COOKIE, opcionesMarca } from "./marca";

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

// False when there is no usable SESSION_SECRET: no marker is set, and the
// session would be refused on the next request.
export async function sellarActividad(sesionId: string): Promise<boolean> {
  const clave = await claveMarcaEntorno();
  if (!clave) return false;
  const valor = await firmarMarca(clave, sesionId, Date.now());
  (await cookies()).set(MARCA_COOKIE, valor, opcionesMarca(await esHttps()));
  return true;
}

export async function borrarActividad(): Promise<void> {
  (await cookies()).delete(MARCA_COOKIE);
}
