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
