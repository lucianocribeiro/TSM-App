// The secret behind the inactivity marker's signing key (SESSION_SECRET):
// dedicated to it, server-only, different per environment. Rotating it
// invalidates every marker, so everyone is signed out once.
//
// Fails closed: when it is missing or too short, there is no key, every
// marker is invalid and every protected route is refused (and nobody can
// sign in). One configuration error is logged, never the value.

// 32 random bytes are 43 base64url characters.
export const SECRETO_MIN_CARACTERES = 43;

let avisado = false;

export function leerSecretoSesion(valor: string | undefined = process.env.SESSION_SECRET): string | null {
  if (typeof valor === "string" && valor.length >= SECRETO_MIN_CARACTERES) return valor;
  if (!avisado) {
    avisado = true;
    console.error(
      `[sesion] SESSION_SECRET is ${valor ? "too short" : "missing"}: it must be at least ${SECRETO_MIN_CARACTERES} characters (32+ random bytes, base64url). Every session is refused until it is set.`,
    );
  }
  return null;
}
