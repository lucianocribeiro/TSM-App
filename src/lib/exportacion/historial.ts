import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { copyLaborales } from "@/lib/copy/laborales";
import type { CatalogoItem } from "@/lib/configuracion/listas";
import { formatearFechaHora } from "@/lib/format/fecha";
import { CAMPOS_EXPORTACION, camposDelGrupo, esCampoExportacion, GRUPOS_EXPORTACION } from "./campos";
import { validarFiltros } from "./filtros";

// The export log (exportaciones) as the Historial de exportaciones view shows
// it (CR-4). Pure. Never an id: actors by name or email (else the fallback
// copy), list items by name. The search text is shown: this view is Admin
// only, like the log.

export type ExportacionRegistrada = {
  id: string;
  actorId: string;
  fecha: string;
  campos: readonly string[];
  incluyeHijos: boolean;
  cantidad: number;
  filtros: unknown;
  resultado: string;
};

export type FilaExportacion = {
  id: string;
  fecha: string;
  usuario: string;
  cantidad: string;
  campos: string;
  hijos: string;
  filtros: string;
  // False for an attempt that failed (logged with result "error").
  completada: boolean;
};

const t = copy.exportacion.historial;
const tf = copyLaborales.listado.filtros;

// A group named once when all of its fields went out, else its fields' labels.
export function resumirCampos(campos: readonly string[]): string {
  const elegidos = new Set(campos.filter(esCampoExportacion));
  const partes: string[] = [];
  for (const { grupo, titulo } of GRUPOS_EXPORTACION) {
    const delGrupo = camposDelGrupo(grupo);
    const enEste = delGrupo.filter((campo) => elegidos.has(campo));
    if (enEste.length === 0) continue;
    if (enEste.length === delGrupo.length) {
      partes.push(formatCopy(t.grupoCompleto, { grupo: titulo }));
    } else {
      partes.push(...CAMPOS_EXPORTACION.filter((config) => enEste.includes(config.campo)).map((config) => config.label));
    }
  }
  return partes.join(t.separador);
}

export function resumirFiltros(filtros: unknown, items: readonly CatalogoItem[]): string {
  const f = validarFiltros(filtros);
  if (!f) return t.sinFiltros;
  const nombre = (id: string) => items.find((item) => item.id === id)?.nombre ?? t.itemNoDisponible;
  const partes: string[] = [];
  if (f.busqueda.trim()) partes.push(formatCopy(t.busqueda, { texto: f.busqueda.trim() }));
  if (f.estadoLaboral) partes.push(formatCopy(t.filtro, { filtro: tf.estadoLaboral, valor: copyLaborales.estados[f.estadoLaboral] }));
  if (f.areaId) partes.push(formatCopy(t.filtro, { filtro: tf.area, valor: nombre(f.areaId) }));
  if (f.sucursalId) partes.push(formatCopy(t.filtro, { filtro: tf.sucursal, valor: nombre(f.sucursalId) }));
  if (f.tareaId) partes.push(formatCopy(t.filtro, { filtro: tf.tarea, valor: nombre(f.tareaId) }));
  if (f.mostrarBajas) partes.push(t.conBajas);
  return partes.length > 0 ? partes.join(t.separador) : t.sinFiltros;
}

// nombres: by profile id, from nombresDeActores (Configuración history).
export function filaExportacion(
  registro: ExportacionRegistrada,
  nombres: ReadonlyMap<string, string>,
  items: readonly CatalogoItem[],
): FilaExportacion {
  return {
    id: registro.id,
    fecha: formatearFechaHora(registro.fecha),
    usuario: nombres.get(registro.actorId) ?? t.usuarioNoDisponible,
    cantidad: String(registro.cantidad),
    campos: resumirCampos(registro.campos),
    hijos: registro.incluyeHijos ? t.si : t.no,
    filtros: resumirFiltros(registro.filtros, items),
    completada: registro.resultado === "ok",
  };
}
