import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { formatearFechaHora } from "@/lib/format/fecha";
import type { Database } from "@/lib/supabase/database.types";
import type { CatalogoLista } from "./listas";

// The Configuración history (catalogo_eventos) as the Historial view shows
// it. Pure.

type CatalogoAccion = Database["public"]["Enums"]["catalogo_accion"];

export type EventoCatalogo = {
  id: string;
  lista: CatalogoLista;
  itemNombre: string;
  areaNombre: string | null;
  accion: CatalogoAccion;
  valorAnterior: string | null;
  valorNuevo: string | null;
  actorId: string;
  fecha: string;
};

export type FilaHistorial = {
  id: string;
  fecha: string;
  usuario: string;
  lista: string;
  item: string;
  accion: string;
  antes: string;
  despues: string;
};

const t = copy.configuracion.historial;

// A stored value as the user reads it: positions and states in words.
function valor(accion: CatalogoAccion, crudo: string | null): string {
  if (crudo === null) return t.sinValor;
  if (accion === "reorden") return formatCopy(t.posicion, { n: crudo });
  if (accion === "desactivacion" || accion === "reactivacion") {
    return crudo === "activo" ? copy.configuracion.estados.activo : copy.configuracion.estados.inactivo;
  }
  return crudo;
}

// Who acted, by profile id: the name from their legajo, else their email, as
// in Usuarios. Accounts with neither are left out.
export function nombresDeActores(cuentas: readonly { id: string; nombre: string | null; email: string | null }[]): Map<string, string> {
  const nombres = new Map<string, string>();
  for (const cuenta of cuentas) {
    const nombre = cuenta.nombre?.trim() || cuenta.email?.trim();
    if (nombre) nombres.set(cuenta.id, nombre);
  }
  return nombres;
}

// The actor as a page shows them (Configuración and Usuarios histories): an
// actor that nombres cannot name is shown with the fallback copy, never with
// their id.
export function nombreDeActor(nombres: ReadonlyMap<string, string>, actorId: string): string {
  return nombres.get(actorId) ?? t.usuarioNoDisponible;
}

// nombres: from nombresDeActores.
export function filaHistorial(evento: EventoCatalogo, nombres: ReadonlyMap<string, string>): FilaHistorial {
  const lista = copy.configuracion.listas[evento.lista];
  return {
    id: evento.id,
    fecha: formatearFechaHora(evento.fecha),
    usuario: nombreDeActor(nombres, evento.actorId),
    lista: evento.areaNombre ? formatCopy(t.listaConArea, { lista, area: evento.areaNombre }) : lista,
    item: evento.itemNombre,
    accion: t.acciones[evento.accion],
    antes: valor(evento.accion, evento.valorAnterior),
    despues: valor(evento.accion, evento.valorNuevo),
  };
}
