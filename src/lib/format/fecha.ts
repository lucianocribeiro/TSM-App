// Dates and times shown to users: es-AR, 24-hour clock, in Argentina's time
// zone whatever the server's or browser's zone is. Example: 27/09/2026, 00:30.
const FECHA_HORA = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Buenos_Aires",
});

export function formatearFechaHora(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : FECHA_HORA.format(date);
}

// A calendar date (YYYY-MM-DD, no time) as dd/mm/yyyy. No time zone is
// involved: the date is shown as stored. Empty for anything else.
export function formatearFecha(isoDate: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

const PESOS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

// Money in pesos, es-AR: $ 1.234.567,89.
export function formatearPesos(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? "" : PESOS.format(value);
}
