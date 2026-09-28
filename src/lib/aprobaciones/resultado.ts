import { copy } from "@/lib/copy/es-AR";

// After a decision the detail page goes back to the inbox with
// ?resultado=<code>, and the inbox confirms it. Only these codes are shown.
export const RESULTADOS_DECISION = [
  "solicitudAprobada",
  "solicitudRechazada",
  "documentoAprobado",
  "documentoRechazado",
] as const;
export type ResultadoDecision = (typeof RESULTADOS_DECISION)[number];

export function esResultadoDecision(value: unknown): value is ResultadoDecision {
  return typeof value === "string" && (RESULTADOS_DECISION as readonly string[]).includes(value);
}

export function mensajeResultado(resultado: ResultadoDecision): string {
  return copy.aprobaciones.exito[resultado];
}
