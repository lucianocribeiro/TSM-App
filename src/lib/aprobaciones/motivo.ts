import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";

// The reason an Admin gives when rejecting a request or a document. The
// employee sees it verbatim (PRD US-7), so it is trimmed and bounded here;
// the decision functions refuse a blank one as well.

export const MAX_MOTIVO_RECHAZO = 500;

const errors = copy.aprobaciones.errors;

export type MotivoValidado = { ok: true; motivo: string } | { ok: false; error: string };

export function validarMotivo(value: unknown): MotivoValidado {
  const motivo = typeof value === "string" ? value.trim() : "";
  if (!motivo) return { ok: false, error: errors.motivoRequerido };
  if (motivo.length > MAX_MOTIVO_RECHAZO) {
    return { ok: false, error: formatCopy(errors.motivoLargo, { max: String(MAX_MOTIVO_RECHAZO) }) };
  }
  return { ok: true, motivo };
}
