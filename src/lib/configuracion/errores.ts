import { copy } from "@/lib/copy/es-AR";
import type { CatalogoLista } from "./listas";
import type { ErrorNombre } from "./nombre";

// es-AR messages for the Configuración actions. Database details never
// reach the user.

const errors = copy.configuracion.errors;

export function mensajeNombre(error: ErrorNombre, lista: CatalogoLista): string {
  if (error === "vacio") return errors.nombreVacio;
  if (error === "largo") return errors.nombreLargo;
  return lista === "puesto" ? errors.nombreDuplicadoPuesto : errors.nombreDuplicado;
}

export type ErrorBase = { code?: string; hint?: string | null };

// A database refusal on a write: duplicate name (23505, the unique key or,
// at commit, the position), item in use (23503), the item gone (P0002) or
// changed meanwhile (55000 version); anything else is generic.
export function mensajeBase(error: ErrorBase, lista: CatalogoLista | null): string {
  switch (error.code) {
    case "23505":
      return lista ? mensajeNombre("duplicado", lista) : errors.cambioConcurrente;
    case "23503":
      return errors.enUso;
    case "P0002":
      return errors.noEncontrado;
    case "55000":
      if (error.hint === "extremo") return errors.extremo;
      if (error.hint === "version") return errors.cambioConcurrente;
      return errors.accionFallo;
    default:
      return errors.accionFallo;
  }
}
