// CUIL (PRD 5.7): 11 digits written XX-XXXXXXXX-X.
// - The first two digits are one of the person prefixes in CUIL_PREFIJOS.
// - The last digit is the check digit of the first ten (modulo 11 with
//   weights 5,4,3,2,7,6,5,4,3,2). A remainder that gives 10 has no valid
//   check digit for that prefix; ANSES then assigns prefix 23 to that DNI,
//   and the same rule computes its digit (9 from 20, 4 from 27). No special
//   case is needed.

export const CUIL_PREFIJOS = ["20", "23", "24", "27"] as const;

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

export type CuilResultado =
  | { ok: true; cuil: string }
  | { ok: false; motivo: "formato" | "prefijo" | "digito" };

// Accepts "20-12345678-6" or "20123456786" (surrounding spaces ignored).
// Returns the canonical XX-XXXXXXXX-X, or why it is not a valid CUIL.
export function validarCuil(value: string): CuilResultado {
  const trimmed = value.trim();
  if (!INPUT.test(trimmed)) return { ok: false, motivo: "formato" };
  const digits = trimmed.replace(/-/g, "");
  if (!(CUIL_PREFIJOS as readonly string[]).includes(digits.slice(0, 2))) {
    return { ok: false, motivo: "prefijo" };
  }
  if (cuilDigitoVerificador(digits.slice(0, 10)) !== Number(digits[10])) {
    return { ok: false, motivo: "digito" };
  }
  return { ok: true, cuil: `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits[10]}` };
}

// The canonical XX-XXXXXXXX-X, or null when the value is not a valid CUIL.
export function normalizarCuil(value: string): string | null {
  const result = validarCuil(value);
  return result.ok ? result.cuil : null;
}
