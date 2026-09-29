import { clasificarRuta } from "./rutas";

// The page to return to after signing in (?volver=). Only a same-origin
// relative path to a known, non-public route is accepted; anything else
// (absolute URLs, protocol-relative "//", backslashes, control characters,
// and the same tricks percent-encoded) is dropped. No open redirect.

export const VOLVER_PARAM = "volver";
const MAX_LARGO = 512;
const BASE = "http://mi-tsm.invalid";

function sospechosa(valor: string): boolean {
  return (
    !valor.startsWith("/") ||
    valor.startsWith("//") ||
    valor.includes("\\") ||
    // Control characters and whitespace, which browsers strip or fold.
    /[\u0000-\u001f\u007f\s]/.test(valor)
  );
}

export function rutaRetornoSegura(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.length === 0 || valor.length > MAX_LARGO) return null;
  // Every decoding layer must be clean too ("/%2F%2Fevil", "/%5Cevil", ...).
  let actual = valor;
  for (let i = 0; i < 3; i += 1) {
    if (sospechosa(actual)) return null;
    let decodificado: string;
    try {
      decodificado = decodeURIComponent(actual);
    } catch {
      return null;
    }
    if (decodificado === actual) break;
    actual = decodificado;
  }
  if (sospechosa(actual)) return null;

  let url: URL;
  try {
    url = new URL(valor, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const clase = clasificarRuta(url.pathname);
  if (clase === null || clase === "publica") return null;
  return url.pathname + url.search;
}
