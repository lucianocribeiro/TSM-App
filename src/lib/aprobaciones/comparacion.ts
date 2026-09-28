import { normalizarBusqueda } from "@/lib/cuentas/listado";
import { valorActual } from "@/lib/legajo/vista";
import { CAMPOS_SOLICITUD, type CampoGrupo, type CampoSolicitud } from "./campos";
import { parseHijosValor, type HijoValor, type LegajoActual } from "./solicitudes";

// The inbox comparison of a change request (PRD US-7): for each group A to D,
// the fields whose submitted value differs from the current one, and the
// children compared as a list. Values stay in the request text form (see
// src/lib/aprobaciones/solicitudes.ts); the page formats them. Pure.

export type ItemSolicitud = { campo: string; valorPropuesto: string | null };

export type FilaComparacion = {
  campo: Exclude<CampoSolicitud, "hijos">;
  actual: string | null;
  propuesto: string | null;
};

export type CambioHijo =
  | { tipo: "agregado"; hijo: HijoValor }
  | { tipo: "quitado"; hijo: HijoValor }
  | { tipo: "modificado"; hijo: HijoValor; fechaAnterior: string };

export type GrupoComparacion = {
  grupo: CampoGrupo;
  filas: FilaComparacion[];
  // Only when the request includes the children.
  hijos: CambioHijo[] | null;
};

const GRUPOS: readonly CampoGrupo[] = ["A", "B", "C", "D"];

// The groups a request touches, in page order.
export function gruposDeSolicitud(campos: readonly string[]): CampoGrupo[] {
  const tocados = new Set(
    CAMPOS_SOLICITUD.filter((config) => campos.includes(config.campo)).map((config) => config.grupo),
  );
  return GRUPOS.filter((grupo) => tocados.has(grupo));
}

export function construirComparacion(items: readonly ItemSolicitud[], actual: LegajoActual): GrupoComparacion[] {
  const propuestos = new Map(items.map((item) => [item.campo, item.valorPropuesto]));
  return gruposDeSolicitud(items.map((item) => item.campo)).map((grupo) => {
    const campos = CAMPOS_SOLICITUD.filter((config) => config.grupo === grupo && propuestos.has(config.campo));
    const filas: FilaComparacion[] = [];
    let hijos: CambioHijo[] | null = null;
    for (const { campo } of campos) {
      const propuesto = propuestos.get(campo) ?? null;
      if (campo === "hijos") {
        hijos = compararHijos(actual.hijos, parseHijosValor(propuesto) ?? []);
        continue;
      }
      const actualValor = valorActual(actual, campo);
      if (actualValor !== propuesto) filas.push({ campo, actual: actualValor, propuesto });
    }
    return { grupo, filas, hijos };
  });
}

// Children are matched by name (ignoring case, accents and extra spaces), in
// order when a name repeats. A matched child with another birth date is
// modified; the rest are added or removed. Unchanged children are left out.
export function compararHijos(actuales: readonly HijoValor[], propuestos: readonly HijoValor[]): CambioHijo[] {
  const restantes = [...actuales];
  const cambios: CambioHijo[] = [];
  for (const hijo of propuestos) {
    const clave = normalizarBusqueda(hijo.nombre_completo);
    const index = restantes.findIndex((actual) => normalizarBusqueda(actual.nombre_completo) === clave);
    if (index === -1) {
      cambios.push({ tipo: "agregado", hijo });
      continue;
    }
    const [anterior] = restantes.splice(index, 1);
    if (anterior.fecha_nacimiento !== hijo.fecha_nacimiento) {
      cambios.push({ tipo: "modificado", hijo, fechaAnterior: anterior.fecha_nacimiento });
    }
  }
  for (const hijo of restantes) cambios.push({ tipo: "quitado", hijo });
  return cambios;
}
