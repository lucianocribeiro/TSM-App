import { nombreCompleto, normalizarBusqueda } from "@/lib/cuentas/listado";
import type { Database } from "@/lib/supabase/database.types";

// Employee list of /legajos (PRD US-4, US-8). Pure helpers: the rows come
// from cargarListadoLegajos (./admin-legajos.ts), one narrow query without
// children or documents.

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
  area: string | null;
  puesto: string | null;
  sede: string | null;
  modalidad: string | null;
  estadoLaboral: EstadoLaboral | null;
  estadoCuenta: CuentaEstado;
};

export type FiltrosLegajos = {
  busqueda: string;
  // "" = any value.
  estadoLaboral: EstadoLaboral | "";
  area: string;
  sede: string;
  modalidad: string;
  // Deactivated accounts are hidden unless this is on (PRD US-8).
  mostrarBajas: boolean;
};

export const FILTROS_INICIALES: FiltrosLegajos = {
  busqueda: "",
  estadoLaboral: "",
  area: "",
  sede: "",
  modalidad: "",
  mostrarBajas: false,
};

export type CampoTextoLibre = "area" | "sede" | "modalidad";

export function itemDesdeFila(fila: {
  profile_id: string;
  nombres: string | null;
  apellido: string | null;
  dni: string | null;
  cuil: string | null;
  numero_legajo: string | null;
  area: string | null;
  puesto: string | null;
  sede: string | null;
  modalidad: string | null;
  estado_laboral: EstadoLaboral | null;
  estado_cuenta: CuentaEstado;
}): LegajoListItem {
  return {
    profileId: fila.profile_id,
    nombre: nombreCompleto(fila.nombres, fila.apellido),
    nombres: fila.nombres?.trim() || null,
    apellido: fila.apellido?.trim() || null,
    dni: fila.dni,
    cuil: fila.cuil,
    numeroLegajo: fila.numero_legajo,
    area: fila.area,
    puesto: fila.puesto,
    sede: fila.sede,
    modalidad: fila.modalidad,
    estadoLaboral: fila.estado_laboral,
    estadoCuenta: fila.estado_cuenta,
  };
}

// The distinct values of a free-text field (area, sede, modalidad), trimmed,
// compared without case or accents, sorted es-AR. The first spelling found
// is the one shown.
export function opcionesDistintas(items: readonly LegajoListItem[], campo: CampoTextoLibre): string[] {
  const porClave = new Map<string, string>();
  for (const item of items) {
    const valor = item[campo]?.trim();
    if (!valor) continue;
    const clave = normalizarBusqueda(valor);
    if (!porClave.has(clave)) porClave.set(clave, valor);
  }
  return [...porClave.values()].sort((a, b) => a.localeCompare(b, "es-AR"));
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

const mismoTexto = (valor: string | null, filtro: string) =>
  !filtro || normalizarBusqueda(valor ?? "") === normalizarBusqueda(filtro);

export function filtrarLegajos(items: readonly LegajoListItem[], filtros: FiltrosLegajos): LegajoListItem[] {
  return items
    .filter((item) => filtros.mostrarBajas || item.estadoCuenta === "activa")
    .filter((item) => !filtros.estadoLaboral || item.estadoLaboral === filtros.estadoLaboral)
    .filter((item) => mismoTexto(item.area, filtros.area))
    .filter((item) => mismoTexto(item.sede, filtros.sede))
    .filter((item) => mismoTexto(item.modalidad, filtros.modalidad))
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
