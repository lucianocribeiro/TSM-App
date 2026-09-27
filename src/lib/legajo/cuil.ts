// CUIL (PRD 5.7): 11 digits written XX-XXXXXXXX-X, whose last digit is the
// check digit of the first ten (modulo 11 with weights 5,4,3,2,7,6,5,4,3,2).
// A remainder that gives 10 has no valid check digit for that prefix.

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;
const INPUT = /^\d{2}-?\d{8}-?\d$/;

// The check digit for the first ten digits, or null when none exists.
export function cuilDigitoVerificador(primerosDiez: string): number | null {
  if (!/^\d{10}$/.test(primerosDiez)) return null;
  const sum = WEIGHTS.reduce((total, weight, index) => total + weight * Number(primerosDiez[index]), 0);
  const digit = 11 - (sum % 11);
  if (digit === 11) return 0;
  if (digit === 10) return null;
  return digit;
}

// Accepts "20-12345678-6" or "20123456786" (surrounding spaces ignored) and
// returns the canonical XX-XXXXXXXX-X, or null when the format or the check
// digit is wrong.
export function normalizarCuil(value: string): string | null {
  const trimmed = value.trim();
  if (!INPUT.test(trimmed)) return null;
  const digits = trimmed.replace(/-/g, "");
  if (cuilDigitoVerificador(digits.slice(0, 10)) !== Number(digits[10])) return null;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits[10]}`;
}
