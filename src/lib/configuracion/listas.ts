import type { Database } from "@/lib/supabase/database.types";

// The Configuración lists (PRD "Configuración") and the rules the screen
// and, from CR-2, the legajo dropdowns share. Pure.

export type CatalogoLista = Database["public"]["Enums"]["catalogo_lista"];

// Screen order.
export const LISTAS = ["area", "puesto", "sucursal", "convenio", "tarea", "categoria"] as const satisfies readonly CatalogoLista[];

export function esLista(valor: unknown): valor is CatalogoLista {
  return typeof valor === "string" && (LISTAS as readonly string[]).includes(valor);
}

export type CatalogoItem = {
  id: string;
  lista: CatalogoLista;
  nombre: string;
  // Puesto only.
  areaId: string | null;
  posicion: number;
  activo: boolean;
  version: number;
};

// The items of one list (of one Área, for Puesto), in their order.
export function itemsDeGrupo(items: readonly CatalogoItem[], lista: CatalogoLista, areaId: string | null = null): CatalogoItem[] {
  return items
    .filter((item) => item.lista === lista && item.areaId === (lista === "puesto" ? areaId : null))
    .sort((a, b) => a.posicion - b.posicion);
}

// The other names of an item's group, for the duplicate check.
export function nombresDelGrupo(items: readonly CatalogoItem[], lista: CatalogoLista, areaId: string | null, sinId?: string): string[] {
  return itemsDeGrupo(items, lista, areaId)
    .filter((item) => item.id !== sinId)
    .map((item) => item.nombre);
}

export type Direccion = "arriba" | "abajo";

// The neighbour an item swaps places with, or null at that end.
export function vecinoDe(grupo: readonly CatalogoItem[], id: string, direccion: Direccion): CatalogoItem | null {
  const ordenados = [...grupo].sort((a, b) => a.posicion - b.posicion);
  const indice = ordenados.findIndex((item) => item.id === id);
  if (indice === -1) return null;
  return ordenados[direccion === "arriba" ? indice - 1 : indice + 1] ?? null;
}

// The group after moving an item one place (what the database does in
// mover_catalogo_item: the two swap positions). Unchanged at an end.
export function mover(grupo: readonly CatalogoItem[], id: string, direccion: Direccion): CatalogoItem[] {
  const ordenados = [...grupo].sort((a, b) => a.posicion - b.posicion);
  const item = ordenados.find((candidato) => candidato.id === id);
  const vecino = vecinoDe(ordenados, id, direccion);
  if (!item || !vecino) return ordenados;
  return ordenados
    .map((candidato) =>
      candidato.id === item.id
        ? { ...candidato, posicion: vecino.posicion }
        : candidato.id === vecino.id
          ? { ...candidato, posicion: item.posicion }
          : candidato,
    )
    .sort((a, b) => a.posicion - b.posicion);
}

// An item is in use while something references it. Today only Puestos
// reference an Área; from CR-2, legajos reference every list (the database
// refuses the deletion either way, ON DELETE RESTRICT).
export function enUso(items: readonly CatalogoItem[], item: CatalogoItem): boolean {
  return item.lista === "area" && items.some((otro) => otro.lista === "puesto" && otro.areaId === item.id);
}

// Offered for a new selection: active, and for a Puesto, its Área active too.
// A record keeps the item it already has whatever its state.
export function disponibleParaSeleccion(items: readonly CatalogoItem[], item: CatalogoItem): boolean {
  if (!item.activo) return false;
  if (item.lista !== "puesto") return true;
  return items.some((area) => area.id === item.areaId && area.lista === "area" && area.activo);
}

// The options of a dropdown, in order (for a Puesto, of one Área).
export function opcionesDisponibles(items: readonly CatalogoItem[], lista: CatalogoLista, areaId: string | null = null): CatalogoItem[] {
  return itemsDeGrupo(items, lista, areaId).filter((item) => disponibleParaSeleccion(items, item));
}
