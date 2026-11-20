// A period as MM/AAAA (client and server).
export function etiquetaPeriodo(periodo: { anio: number; mes: number }): string {
  return `${String(periodo.mes).padStart(2, "0")}/${periodo.anio}`;
}
