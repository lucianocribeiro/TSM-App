import { CAMPOS_SOLICITUD } from "@/lib/aprobaciones/campos";
import { copy } from "@/lib/copy/es-AR";
import { copyLaborales } from "@/lib/copy/laborales";

// The fields an Admin can export (CR-4), in the file's column order: groups
// A to D (the legajo columns, labelled as in the screens) and group E (the
// Datos laborales read view, antigüedad included). The children are not a
// column: "Hijos" adds a second sheet. Admin only (it carries group E).

export type GrupoExportacion = "A" | "B" | "C" | "D" | "E";

const CAMPOS_E = [
  "numero_legajo",
  "area",
  "puesto",
  "fecha_ingreso",
  "antiguedad",
  "estado_laboral",
  "sucursal",
  "tarea",
  "convenio",
  "categoria",
] as const satisfies readonly (keyof typeof copyLaborales.campos)[];

const CAMPOS_A_D = CAMPOS_SOLICITUD.filter(
  (config): config is Exclude<(typeof CAMPOS_SOLICITUD)[number], { campo: "hijos" }> => config.campo !== "hijos",
);

export type CampoLaboralExportable = (typeof CAMPOS_E)[number];
export type CampoPersonalExportable = (typeof CAMPOS_A_D)[number]["campo"];
export type CampoExportacion = CampoPersonalExportable | CampoLaboralExportable;

export type CampoExportacionConfig = { campo: CampoExportacion; grupo: GrupoExportacion; label: string };

export const CAMPOS_EXPORTACION: readonly CampoExportacionConfig[] = [
  ...CAMPOS_A_D.map((config) => ({ campo: config.campo, grupo: config.grupo, label: copy.aprobaciones.campos[config.labelKey] })),
  ...CAMPOS_E.map((campo) => ({ campo, grupo: "E" as const, label: copyLaborales.campos[campo] })),
];

export const GRUPOS_EXPORTACION: readonly { grupo: GrupoExportacion; titulo: string }[] = [
  { grupo: "A", titulo: copy.miLegajo.grupos.A },
  { grupo: "B", titulo: copy.miLegajo.grupos.B },
  { grupo: "C", titulo: copy.miLegajo.grupos.C },
  { grupo: "D", titulo: copy.miLegajo.grupos.D },
  { grupo: "E", titulo: copyLaborales.grupo },
];

const POR_CAMPO = new Map(CAMPOS_EXPORTACION.map((config) => [config.campo as string, config]));

export function esCampoExportacion(value: unknown): value is CampoExportacion {
  return typeof value === "string" && POR_CAMPO.has(value);
}

export function campoExportacion(campo: CampoExportacion): CampoExportacionConfig {
  return POR_CAMPO.get(campo)!;
}

export function camposDelGrupo(grupo: GrupoExportacion): CampoExportacion[] {
  return CAMPOS_EXPORTACION.filter((config) => config.grupo === grupo).map((config) => config.campo);
}

export type Seleccion = { campos: CampoExportacion[]; hijos: boolean };

// The selection as the server takes it: at least one field, every key from
// the allow-list, none repeated; returned in column order. Anything else is
// refused (null), never trimmed to what is allowed.
export function validarSeleccion(input: unknown): Seleccion | null {
  if (!input || typeof input !== "object") return null;
  const { campos, hijos } = input as { campos?: unknown; hijos?: unknown };
  if (!Array.isArray(campos) || campos.length === 0 || typeof hijos !== "boolean") return null;
  if (!campos.every(esCampoExportacion)) return null;
  if (new Set(campos).size !== campos.length) return null;
  const elegidos = new Set<string>(campos);
  return { campos: CAMPOS_EXPORTACION.filter((config) => elegidos.has(config.campo)).map((config) => config.campo), hijos };
}
