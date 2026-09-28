import type { Database } from "@/lib/supabase/database.types";

// Group E form helpers for /legajos (PRD 5.5). Pure. The server validates
// with datosLaboralesSchema (./validation.ts); these only turn form text
// into the values that schema reads. Antigüedad is calculated, never a field.

type LegajoRow = Database["public"]["Tables"]["legajos"]["Row"];

export const CAMPOS_LABORALES = [
  "numero_legajo",
  "area",
  "puesto",
  "fecha_ingreso",
  "estado_laboral",
  "sede",
  "modalidad",
  "convenio",
  "bruto_mensual",
] as const;
export type CampoLaboral = (typeof CAMPOS_LABORALES)[number];

export type FormLaboral = Record<CampoLaboral, string>;

export function formLaboralInicial(legajo: Pick<LegajoRow, CampoLaboral>): FormLaboral {
  const form = {} as FormLaboral;
  for (const campo of CAMPOS_LABORALES) {
    const valor = legajo[campo];
    form[campo] = valor === null || valor === undefined ? "" : String(valor);
  }
  return form;
}

// "850000", "850000.50", "850.000", "850.000,50" or "850000,5" -> a number.
// Empty -> undefined (the schema says it is required); anything else -> NaN
// (the schema says it is not a valid number). A leading "-" is kept so the
// schema can say it cannot be negative.
export function parseMonto(texto: string): number | undefined {
  const limpio = texto.replace(/[\s$]/g, "");
  if (!limpio) return undefined;
  let normal: string;
  if (limpio.includes(",")) {
    normal = limpio.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(limpio)) {
    // es-AR thousands separators.
    normal = limpio.replace(/\./g, "");
  } else {
    normal = limpio;
  }
  return /^-?\d+(\.\d+)?$/.test(normal) ? Number(normal) : Number.NaN;
}

// The values datosLaboralesSchema validates.
export function valoresLaborales(form: FormLaboral): Record<string, unknown> {
  return {
    ...form,
    estado_laboral: form.estado_laboral || undefined,
    bruto_mensual: parseMonto(form.bruto_mensual),
  };
}
