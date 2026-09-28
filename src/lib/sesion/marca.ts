import { INACTIVIDAD_MS, MARCA_DESFASE_MS, MARCA_RENOVAR_MS } from "./tiempos";

// Server-side inactivity enforcement: the last-activity marker.
//
// An httpOnly cookie "v1.<session id>.<last activity, ms>.<signature>". The
// signature is an HMAC-SHA256 over the first three parts, with a key only the
// server has: derived (HKDF) from the server-only SUPABASE_SERVICE_ROLE_KEY,
// so no new secret is needed, and the service-role key itself is never used
// or exposed as a key. The browser cannot read it (httpOnly), cannot stamp a
// later time (the signature would not match), and cannot reuse a marker from
// another session (the session id is part of what is signed and must match
// the JWT's session_id). Only the server re-stamps it, on requests the user
// makes (navigations, Server Actions, and the explicit keep-alive). A closed
// laptop or a stopped script sends nothing, so the marker ages and the
// session is refused once it is older than INACTIVIDAD_MS. A missing marker
// counts as expired.

export const MARCA_COOKIE = "tsm-actividad";
const VERSION = "v1";
const INFO = "mi-tsm/actividad/v1";

const encoder = new TextEncoder();

let clavePromesa: Promise<CryptoKey> | null = null;
let claveOrigen: string | null = null;

// The HMAC key, derived once per secret.
export function claveMarca(secreto: string): Promise<CryptoKey> {
  if (clavePromesa && claveOrigen === secreto) return clavePromesa;
  claveOrigen = secreto;
  clavePromesa = (async () => {
    const base = await crypto.subtle.importKey("raw", encoder.encode(secreto), "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode(INFO) },
      base,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign", "verify"],
    );
  })();
  return clavePromesa;
}

function base64url(bytes: ArrayBuffer): string {
  let binario = "";
  for (const byte of new Uint8Array(bytes)) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function desdeBase64url(texto: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(texto)) return null;
  let binario: string;
  try {
    binario = atob(texto.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

const SESION_ID = /^[0-9a-f-]{8,64}$/i;

export async function firmarMarca(clave: CryptoKey, sesionId: string, instante: number): Promise<string> {
  const datos = `${VERSION}.${sesionId}.${Math.floor(instante)}`;
  const firma = await crypto.subtle.sign("HMAC", clave, encoder.encode(datos));
  return `${datos}.${base64url(firma)}`;
}

export type EstadoMarca =
  | { estado: "vigente"; instante: number; renovar: boolean }
  | { estado: "vencida" }
  | { estado: "invalida" };

// Checks a marker against the current session and time. "invalida": missing,
// malformed, forged, altered or from another session. Callers treat
// "invalida" and "vencida" the same way (the session ends).
export async function leerMarca(
  clave: CryptoKey,
  valor: string | undefined,
  sesionId: string,
  ahora: number,
): Promise<EstadoMarca> {
  if (!valor || valor.length > 256) return { estado: "invalida" };
  const partes = valor.split(".");
  if (partes.length !== 4) return { estado: "invalida" };
  const [version, id, instanteTexto, firmaTexto] = partes;
  if (version !== VERSION || id !== sesionId || !SESION_ID.test(id) || !/^\d{1,16}$/.test(instanteTexto)) {
    return { estado: "invalida" };
  }
  const firma = desdeBase64url(firmaTexto);
  if (!firma) return { estado: "invalida" };
  const valida = await crypto.subtle.verify("HMAC", clave, firma, encoder.encode(`${version}.${id}.${instanteTexto}`));
  if (!valida) return { estado: "invalida" };

  const instante = Number(instanteTexto);
  if (instante > ahora + MARCA_DESFASE_MS) return { estado: "invalida" };
  if (ahora - instante > INACTIVIDAD_MS) return { estado: "vencida" };
  return { estado: "vigente", instante, renovar: ahora - instante >= MARCA_RENOVAR_MS };
}

// Cookie attributes. Secure whenever the site is served over HTTPS (always
// in production); plain HTTP only for local development and CI.
export function opcionesMarca(seguro: boolean) {
  return { httpOnly: true, secure: seguro, sameSite: "lax" as const, path: "/", maxAge: Math.ceil(INACTIVIDAD_MS / 1000) };
}

// The session id (auth.sessions) of a Supabase access token. Only for a token
// the Auth server has just issued to this request; elsewhere the id comes
// from verified claims.
export function sesionIdDeToken(accessToken: string): string | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { session_id?: unknown };
    return typeof json.session_id === "string" && SESION_ID.test(json.session_id) ? json.session_id : null;
  } catch {
    return null;
  }
}
