import { nombreCompleto, normalizarBusqueda } from "@/lib/cuentas/listado";
import { disponibleParaSeleccion, itemsDeGrupo, type CatalogoItem, type CatalogoLista } from "@/lib/configuracion/listas";
import type { Database } from "@/lib/supabase/database.types";
import { nombreItem, type Opcion } from "./laborales";

// Employee list of /legajos (PRD US-4, US-8). Pure helpers: the rows come
// from cargarListadoLegajos (./admin-legajos.ts), one narrow query without
// children or documents, plus the Configuración lists for the names.

type EstadoLaboral = Database["public"]["Enums"]["estado_laboral"];
type CuentaEstado = Database["public"]["Enums"]["cuenta_estado"];

export type LegajoListItem = {
  profileId: string;
  // "Nombres Apellido", when either is filled.
  nombre: string | null;
  nombres: string | null;
  apellido: string | null;
  dni: string | null;
  cuil: string | null;
  numeroLegajo: string | null;
  // List items: the id (for the filters) and the name shown.
  areaId: string | null;
  area: string | null;
  puesto: string | null;
  sucursalId: string | null;
  sucursal: string | null;
  tareaId: string | null;
  tarea: string | null;
  estadoLaboral: EstadoLaboral | null;
  // YYYY-MM-DD, for the "Ingresos del mes" card.
  fechaIngreso: string | null;
  estadoCuenta: CuentaEstado;
};

export type FiltrosLegajos = {
  busqueda: string;
  // "" = any value. Área, Sucursal and Tarea by list item id.
  estadoLaboral: EstadoLaboral | "";
  areaId: string;
  sucursalId: string;
  tareaId: string;
  // Deactivated accounts are hidden unless this is on (PRD US-8).
  mostrarBajas: boolean;
};

export const FILTROS_INICIALES: FiltrosLegajos = {
  busqueda: "",
  estadoLaboral: "",
  areaId: "",
  sucursalId: "",
  tareaId: "",
  mostrarBajas: false,
};

// The list filters on these lists.
export type ListaFiltro = Extract<CatalogoLista, "area" | "sucursal" | "tarea">;
const CAMPO_FILTRO = { area: "areaId", sucursal: "sucursalId", tarea: "tareaId" } as const satisfies Record<
  ListaFiltro,
  keyof LegajoListItem & keyof FiltrosLegajos
>;

export type FilaLaboral = {
  numero_legajo: string | null;
  area_id: string | null;
  puesto_id: string | null;
  sucursal_id: string | null;
  tarea_id: string | null;
  estado_laboral: EstadoLaboral | null;
  fecha_ingreso: string | null;
};

export function itemDesdeFila(
  fila: {
    profile_id: string;
    nombres: string | null;
    apellido: string | null;
    dni: string | null;
    cuil: string | null;
    // Group E; null when it could not be joined.
    laboral: FilaLaboral | null;
    estado_cuenta: CuentaEstado;
  },
  items: readonly CatalogoItem[],
): LegajoListItem {
  const porId = new Map(items.map((item) => [item.id, item]));
  const nombre = (id: string | null | undefined) => {
    const item = id ? porId.get(id) : undefined;
    return item ? nombreItem(item) : null;
  };
  const laboral = fila.laboral;
  return {
    profileId: fila.profile_id,
    nombre: nombreCompleto(fila.nombres, fila.apellido),
    nombres: fila.nombres?.trim() || null,
    apellido: fila.apellido?.trim() || null,
    dni: fila.dni,
    cuil: fila.cuil,
    numeroLegajo: laboral?.numero_legajo ?? null,
    areaId: laboral?.area_id ?? null,
    area: nombre(laboral?.area_id),
    puesto: nombre(laboral?.puesto_id),
    sucursalId: laboral?.sucursal_id ?? null,
    sucursal: nombre(laboral?.sucursal_id),
    tareaId: laboral?.tarea_id ?? null,
    tarea: nombre(laboral?.tarea_id),
    estadoLaboral: laboral?.estado_laboral ?? null,
    fechaIngreso: laboral?.fecha_ingreso ?? null,
    estadoCuenta: fila.estado_cuenta,
  };
}

// A filter's options: the items offered in Configuración, in order, plus any
// inactive item a legajo of the list still has, marked "(inactivo)".
export function opcionesFiltro(items: readonly CatalogoItem[], legajos: readonly LegajoListItem[], lista: ListaFiltro): Opcion[] {
  const campo = CAMPO_FILTRO[lista];
  const enUso = new Set(legajos.map((legajo) => legajo[campo]).filter((id): id is string => Boolean(id)));
  return itemsDeGrupo(items, lista)
    .filter((item) => disponibleParaSeleccion(items, item) || enUso.has(item.id))
    .map((item) => ({ value: item.id, label: nombreItem(item) }));
}

const soloDigitos = (value: string) => value.replace(/\D/g, "");

// The search matches name (either order, no case or accents), número de
// legajo, and, by its digits, DNI and CUIL (with or without hyphens).
export function coincideBusqueda(item: LegajoListItem, busqueda: string): boolean {
  const term = normalizarBusqueda(busqueda);
  if (!term) return true;
  const texto = [item.nombre, nombreCompleto(item.apellido, item.nombres), item.numeroLegajo]
    .filter((value): value is string => Boolean(value))
    .map(normalizarBusqueda);
  if (texto.some((value) => value.includes(term))) return true;

  // Digits only when the term is a number (hyphens, dots and spaces allowed).
  if (!/^[\d\s.-]+$/.test(term)) return false;
  const digitos = soloDigitos(term);
  if (!digitos) return false;
  return [item.dni, item.cuil].some((value) => value !== null && soloDigitos(value).includes(digitos));
}

const mismoItem = (valor: string | null, filtro: string) => !filtro || valor === filtro;

export function filtrarLegajos(items: readonly LegajoListItem[], filtros: FiltrosLegajos): LegajoListItem[] {
  return items
    .filter((item) => filtros.mostrarBajas || item.estadoCuenta === "activa")
    .filter((item) => !filtros.estadoLaboral || item.estadoLaboral === filtros.estadoLaboral)
    .filter((item) => mismoItem(item.areaId, filtros.areaId))
    .filter((item) => mismoItem(item.sucursalId, filtros.sucursalId))
    .filter((item) => mismoItem(item.tareaId, filtros.tareaId))
    .filter((item) => coincideBusqueda(item, filtros.busqueda))
    .sort(compararLegajos);
}

// By apellido, then full name; rows without a name last, by número de legajo.
function compararLegajos(a: LegajoListItem, b: LegajoListItem): number {
  if (a.nombre && b.nombre) {
    const porApellido = (a.apellido ?? "").localeCompare(b.apellido ?? "", "es-AR");
    if (porApellido !== 0) return porApellido;
    return a.nombre.localeCompare(b.nombre, "es-AR");
  }
  if (a.nombre || b.nombre) return a.nombre ? -1 : 1;
  return (a.numeroLegajo ?? "").localeCompare(b.numeroLegajo ?? "", "es-AR");
}
