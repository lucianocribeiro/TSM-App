// Carga de recibos: the outcome of registering an upload and the dialog
// sequence that follows it (F2-04, RF-08 to RF-11). Pure, no I/O, no copy:
// shared by the Server Actions and the screen. Admin only (ESLint keeps it
// out of Mi Legajo and the shared modules).
//
// After the file is in storage, the server answers one of:
// - registrado: the receipt is saved;
// - confirmar_dni: the DNI check failed or was impossible; the Admin
//   chooses Aceptar (call again confirming that motivo) or Rechazar
//   (discard the file);
// - confirmar_reemplazo: the employee already has a receipt in the period;
//   Reemplazar (call again confirming it) or Cancelar (discard the file).
// The DNI question always comes first: the server asks about the replacement
// only once the DNI is found or its motivo confirmed. Confirmations add up:
// the second call carries the first answer too.

import type { Database } from "@/lib/supabase/database.types";

// The override reasons of the database (recibo_override_motivo).
export type MotivoDni = Database["public"]["Enums"]["recibo_override_motivo"];
export const MOTIVOS_DNI = ["dni_no_encontrado", "no_verificable", "sin_dni"] as const satisfies readonly MotivoDni[];

// Why the DNI could not be verified (F2-07 wrapper reasons).
export type DetalleNoVerificable = "sin_texto" | "ilegible" | "demasiado_grande" | "tiempo_agotado";

export type ResultadoRegistro =
  | { estado: "registrado"; reciboId: string }
  | { estado: "confirmar_dni"; motivo: MotivoDni; detalle?: DetalleNoVerificable }
  | { estado: "confirmar_reemplazo"; firmado: boolean };

export type Confirmaciones = { confirmarDni?: MotivoDni; confirmarReemplazo?: true };

export type Paso =
  | { tipo: "listo"; reciboId: string }
  | { tipo: "dialogo_dni"; motivo: MotivoDni; detalle?: DetalleNoVerificable }
  | { tipo: "dialogo_reemplazo"; firmado: boolean };

export function pasoSiguiente(resultado: ResultadoRegistro): Paso {
  switch (resultado.estado) {
    case "registrado":
      return { tipo: "listo", reciboId: resultado.reciboId };
    case "confirmar_dni":
      return { tipo: "dialogo_dni", motivo: resultado.motivo, ...(resultado.detalle ? { detalle: resultado.detalle } : {}) };
    case "confirmar_reemplazo":
      return { tipo: "dialogo_reemplazo", firmado: resultado.firmado };
  }
}

// The Admin's answer to a dialog: the confirmations for the next call, or
// "descartar" (Rechazar / Cancelar: the uploaded file is discarded).
export function responder(previas: Confirmaciones, paso: Paso, acepta: boolean): Confirmaciones | "descartar" {
  if (paso.tipo === "listo") return previas;
  if (!acepta) return "descartar";
  if (paso.tipo === "dialogo_dni") return { ...previas, confirmarDni: paso.motivo };
  return { ...previas, confirmarReemplazo: true };
}
