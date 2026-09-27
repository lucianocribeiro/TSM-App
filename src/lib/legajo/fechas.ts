// "Today" for date rules is the date in Argentina, whatever the server's or
// browser's time zone: a date is in the future when it is after that day.
const HOY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "America/Argentina/Buenos_Aires",
});

// YYYY-MM-DD in Argentina at the given instant (default now).
export function hoyEnArgentina(now: Date = new Date()): string {
  return HOY.format(now);
}

// ISO dates compare correctly as strings.
export function esFechaFutura(isoDate: string, now: Date = new Date()): boolean {
  return isoDate > hoyEnArgentina(now);
}
