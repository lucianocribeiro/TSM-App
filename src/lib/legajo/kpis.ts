import { hoyEnArgentina } from "./fechas";
import type { LegajoListItem } from "./listado";

// KPI cards of the Legajos list (PRD US-4, Fase 1). Pure, over the whole
// list: never the filtered rows. "En licencia" (Fase 3) and "Recibos sin
// firmar" (Fase 2) are not part of Fase 1.
// - Activos: employees whose account is not deactivated.
// - Ingresos del mes: of those, the ones whose fecha de ingreso is in the
//   current calendar month in Argentina.

export type KpisLegajos = { activos: number; ingresosDelMes: number };

export function calcularKpis(
  items: readonly Pick<LegajoListItem, "estadoCuenta" | "fechaIngreso">[],
  now: Date = new Date(),
): KpisLegajos {
  // YYYY-MM of today in Argentina; fecha_ingreso is a plain YYYY-MM-DD date.
  const mes = hoyEnArgentina(now).slice(0, 7);
  const activos = items.filter((item) => item.estadoCuenta === "activa");
  return {
    activos: activos.length,
    ingresosDelMes: activos.filter((item) => item.fechaIngreso?.slice(0, 7) === mes).length,
  };
}
