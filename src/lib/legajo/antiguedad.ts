export type Antiguedad = {
  anios: number;
  meses: number;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type DateParts = { year: number; month: number; day: number };

function parseIsoDate(value: string): DateParts | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Completed years and months from fechaIngreso to fechaReferencia, both
// ISO dates (YYYY-MM-DD). A month is complete when the reference day reaches
// the ingreso day, or when the reference is the last day of a shorter month
// (31 Jan → 28 Feb is one month). Returns null for invalid dates and
// 0 years 0 months when the reference is before the ingreso date.
export function calcularAntiguedad(
  fechaIngreso: string,
  fechaReferencia: string,
): Antiguedad | null {
  const desde = parseIsoDate(fechaIngreso);
  const hasta = parseIsoDate(fechaReferencia);
  if (!desde || !hasta) return null;

  let totalMeses = (hasta.year - desde.year) * 12 + (hasta.month - desde.month);
  const esFinDeMes = hasta.day === daysInMonth(hasta.year, hasta.month);
  if (hasta.day < desde.day && !esFinDeMes) {
    totalMeses -= 1;
  }

  if (totalMeses < 0) {
    return { anios: 0, meses: 0 };
  }
  return { anios: Math.floor(totalMeses / 12), meses: totalMeses % 12 };
}
