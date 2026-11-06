import "server-only";
import { extractText, getResolvedPDFJS } from "unpdf";

// DNI check of an uploaded receipt (PRD Fase 2 RF-08, F2-07). Extracts the
// text of every page with unpdf (pdf.js built for serverless: no worker
// file, no canvas, no filesystem) and looks for the employee's DNI.
//
// Never log the file content or the DNI: results carry state codes only.

export const MAX_PAGINAS_DNI = 20;
export const TIEMPO_MAXIMO_DNI_MS = 5_000;

export type ResultadoDni =
  | { estado: "encontrado" }
  | { estado: "no_encontrado" }
  | { estado: "no_verificable"; motivo: "sin_texto" | "ilegible" | "demasiado_grande" | "tiempo_agotado" }
  | { estado: "sin_dni" };

// The stored DNI (digits only, 7 or 8) as a pattern: an optional single "."
// or whitespace between consecutive digits, and no digit right before or
// after the match. So 12.345.678, 12345678, 12 345 678 and the DNI inside a
// CUIL 20-12345678-3 match; 112345678 and 123456789 do not. Anything else
// (null, empty, wrong length) is not a usable DNI: null.
export function patronDni(dni: string | null): RegExp | null {
  const digitos = dni?.trim() ?? "";
  if (!/^\d{7,8}$/.test(digitos)) return null;
  return new RegExp(`(?<!\\d)${digitos.split("").join("[.\\s]?")}(?!\\d)`, "u");
}

export type MotivoNoVerificable = Extract<ResultadoDni, { estado: "no_verificable" }>["motivo"];

// The text of every page, within the page and time limits. "sin_texto" is
// left to the caller: an empty page list or empty pages come back as is.
export type TextoPdf = { ok: true; paginas: string[] } | { ok: false; motivo: Exclude<MotivoNoVerificable, "sin_texto"> };

const TIEMPO_AGOTADO = Symbol("tiempo_agotado");

export async function extraerTextoPdf(bytes: Uint8Array): Promise<TextoPdf> {
  const { getDocument } = await getResolvedPDFJS();
  // pdf.js may take over the buffer it is given: it gets a copy.
  const tarea = getDocument({
    data: bytes.slice(),
    verbosity: 0,
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: false,
  });

  let reloj: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<typeof TIEMPO_AGOTADO>((resolve) => {
    reloj = setTimeout(() => resolve(TIEMPO_AGOTADO), TIEMPO_MAXIMO_DNI_MS);
  });

  const extraccion = (async (): Promise<TextoPdf> => {
    const documento = await tarea.promise;
    if (documento.numPages > MAX_PAGINAS_DNI) return { ok: false, motivo: "demasiado_grande" };
    const { text } = await extractText(documento, { mergePages: false });
    return { ok: true, paginas: text };
  })();
  // A late rejection after the time limit must not surface as unhandled.
  extraccion.catch(() => undefined);

  try {
    const resultado = await Promise.race([extraccion, limite]);
    return resultado === TIEMPO_AGOTADO ? { ok: false, motivo: "tiempo_agotado" } : resultado;
  } catch {
    // Encrypted, corrupt or not a PDF.
    return { ok: false, motivo: "ilegible" };
  } finally {
    clearTimeout(reloj);
    // Stops any work still running (time limit) and frees the document.
    await tarea.destroy().catch(() => undefined);
  }
}

export async function verificarDniEnPdf(bytes: Uint8Array, dni: string | null): Promise<ResultadoDni> {
  const patron = patronDni(dni);
  if (!patron) return { estado: "sin_dni" };
  const texto = await extraerTextoPdf(bytes);
  if (!texto.ok) return { estado: "no_verificable", motivo: texto.motivo };
  if (texto.paginas.every((pagina) => pagina.trim() === "")) return { estado: "no_verificable", motivo: "sin_texto" };
  // Page by page, so no match is made of digits from two pages.
  return texto.paginas.some((pagina) => patron.test(pagina)) ? { estado: "encontrado" } : { estado: "no_encontrado" };
}
