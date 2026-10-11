import { z } from "zod";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { copyLaborales } from "@/lib/copy/laborales";
import { disponibleParaSeleccion, opcionesDisponibles, type CatalogoItem, type CatalogoLista } from "@/lib/configuracion/listas";
import { formatearFecha } from "@/lib/format/fecha";
import type { Database } from "@/lib/supabase/database.types";
import { calcularAntiguedad } from "./antiguedad";
import { hoyEnArgentina } from "./fechas";
import { ESTADOS_LABORALES } from "./options";
import { fieldErrors, option, requiredPastDate, requiredText } from "./validation";
import { textoAntiguedad } from "./vista";

// Group E (PRD 5.5), Admin only: the schema, the form of /legajos/[id], the
// shared validator its action and form both run, and the read view. Pure.
// Área, Puesto, Sucursal, Tarea, Convenio and Categoría are items of the
// Configuración lists, stored by id. Antigüedad is calculated, never a field.
// Admin only, with its copy (@/lib/copy/laborales): Mi Legajo must not import
// it (AUDCR2-01; ESLint and scripts/bundle-mi-legajo.mjs check it).

export type LaboralRow = Database["public"]["Tables"]["legajos_laborales"]["Row"];

const v = copy.legajo.validation;

// Área, Puesto, Sucursal, Tarea, Convenio and Categoría are list item ids;
// that each one is an item of its list (and the Puesto of the Área) is
// checked against the lists by validarDatosLaborales.
const requiredId = () => requiredText().pipe(z.uuid({ error: v.optionInvalid }));
const optionalId = () =>
  z
    .string({ error: v.optionInvalid })
    .nullish()
    .transform((value) => value || null)
    .pipe(z.uuid({ error: v.optionInvalid }).nullable());

export const datosLaboralesSchema = z.object({
  numero_legajo: requiredText(),
  area_id: requiredId(),
  puesto_id: requiredId(),
  fecha_ingreso: requiredPastDate(),
  estado_laboral: option(ESTADOS_LABORALES),
  sucursal_id: requiredId(),
  tarea_id: optionalId(),
  convenio_id: optionalId(),
  categoria_id: optionalId(),
});

export type DatosLaboralesInput = z.input<typeof datosLaboralesSchema>;
export type DatosLaborales = z.output<typeof datosLaboralesSchema>;

export const CAMPOS_LABORALES = [
  "numero_legajo",
  "area_id",
  "puesto_id",
  "fecha_ingreso",
  "estado_laboral",
  "sucursal_id",
  "tarea_id",
  "convenio_id",
  "categoria_id",
] as const;
export type CampoLaboral = (typeof CAMPOS_LABORALES)[number];

// The list behind each dropdown field.
export const LISTA_DE_CAMPO = {
  area_id: "area",
  puesto_id: "puesto",
  sucursal_id: "sucursal",
  tarea_id: "tarea",
  convenio_id: "convenio",
  categoria_id: "categoria",
} as const satisfies Partial<Record<CampoLaboral, CatalogoLista>>;
export type CampoLista = keyof typeof LISTA_DE_CAMPO;
export const CAMPOS_LISTA = Object.keys(LISTA_DE_CAMPO) as CampoLista[];

export function esCampoLista(campo: CampoLaboral): campo is CampoLista {
  return campo in LISTA_DE_CAMPO;
}

// PRD 5.7. The database refuses a group E write without them
// (legajos_laborales_validar).
export const CAMPOS_OBLIGATORIOS: ReadonlySet<CampoLaboral> = new Set([
  "numero_legajo",
  "area_id",
  "puesto_id",
  "fecha_ingreso",
  "estado_laboral",
  "sucursal_id",
]);

// The current values of a legajo's group E (null fields as nothing chosen).
export type ActualLaboral = Partial<Record<CampoLaboral, string | null>>;

export type FormLaboral = Record<CampoLaboral, string>;

export function formLaboralInicial(actual: ActualLaboral | null): FormLaboral {
  const form = {} as FormLaboral;
  for (const campo of CAMPOS_LABORALES) form[campo] = actual?.[campo] ?? "";
  return form;
}

// The values datosLaboralesSchema validates: a select left empty is null.
export function valoresLaborales(form: FormLaboral): Record<string, unknown> {
  const valores: Record<string, unknown> = { ...form };
  for (const campo of CAMPOS_LISTA) valores[campo] = form[campo] || null;
  valores.estado_laboral = form.estado_laboral || undefined;
  return valores;
}

// A name as the Admin reads it: an inactive item is marked.
export function nombreItem(item: CatalogoItem): string {
  return item.activo ? item.nombre : formatCopy(copyLaborales.form.inactivo, { nombre: item.nombre });
}

export type Opcion = { value: string; label: string };

// A dropdown's options: the items offered for a new selection, in
// Configuración order (for Puesto, of the chosen Área), plus the legajo's
// current item when it is no longer offered, marked "(inactivo)".
export function opcionesCampo(
  items: readonly CatalogoItem[],
  campo: CampoLista,
  { actual, areaId }: { actual: string | null | undefined; areaId?: string | null },
): Opcion[] {
  const lista = LISTA_DE_CAMPO[campo];
  if (lista === "puesto" && !areaId) return [];
  const opciones = opcionesDisponibles(items, lista, lista === "puesto" ? (areaId ?? null) : null).map((item) => ({
    value: item.id,
    label: item.nombre,
  }));
  const vigente = actual ? items.find((item) => item.id === actual && item.lista === lista) : undefined;
  if (vigente && !opciones.some((opcion) => opcion.value === vigente.id)) {
    // A Puesto only within its own Área.
    if (lista !== "puesto" || vigente.areaId === areaId) {
      opciones.push({ value: vigente.id, label: formatCopy(copyLaborales.form.inactivo, { nombre: vigente.nombre }) });
    }
  }
  return opciones;
}

export type ValidacionLaboral =
  | { ok: true; datos: DatosLaborales }
  | { ok: false; fieldErrors: Record<string, string> };

// The shared validator (PRD 5.7) of the Admin form and its action: the field
// rules, then the lists. Each id must be an item of its own list, and the
// Puesto one of the chosen Área. An item may be newly chosen only while it
// is offered (active; for a Puesto, its Área active too). The legajo's
// current item stays valid on a save that keeps it.
export function validarDatosLaborales(
  valores: unknown,
  items: readonly CatalogoItem[],
  actual: ActualLaboral | null,
): ValidacionLaboral {
  const parsed = datosLaboralesSchema.safeParse(valores);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const datos = parsed.data;
  const errores: Record<string, string> = {};

  for (const campo of CAMPOS_LISTA) {
    const id = datos[campo];
    if (!id) continue;
    const item = items.find((candidato) => candidato.id === id);
    if (!item || item.lista !== LISTA_DE_CAMPO[campo]) {
      errores[campo] = v.optionInvalid;
    } else if (campo === "puesto_id" && item.areaId !== datos.area_id) {
      errores[campo] = v.puestoFueraDeArea;
    } else if (id !== actual?.[campo] && !disponibleParaSeleccion(items, item)) {
      errores[campo] = v.itemInactivo;
    }
  }

  return Object.keys(errores).length > 0 ? { ok: false, fieldErrors: errores } : { ok: true, datos };
}

export type DatoLaboral = { key: keyof typeof copyLaborales.campos; value: string };

// Group E for display (Admin only), in page order, with antigüedad
// calculated and list items by name (an inactive one marked).
export function datosLaboralesVista(laboral: ActualLaboral | null, items: readonly CatalogoItem[]): DatoLaboral[] {
  const sinDato = copy.miLegajo.sinDato;
  const texto = (value: string | null | undefined) => value || sinDato;
  const item = (id: string | null | undefined) => {
    const encontrado = id ? items.find((candidato) => candidato.id === id) : undefined;
    return encontrado ? nombreItem(encontrado) : sinDato;
  };
  const fechaIngreso = laboral?.fecha_ingreso ?? null;
  const estado = laboral?.estado_laboral;
  return [
    { key: "numero_legajo", value: texto(laboral?.numero_legajo) },
    { key: "area", value: item(laboral?.area_id) },
    { key: "puesto", value: item(laboral?.puesto_id) },
    { key: "fecha_ingreso", value: texto(formatearFecha(fechaIngreso)) },
    {
      key: "antiguedad",
      value: fechaIngreso ? textoAntiguedad(calcularAntiguedad(fechaIngreso, hoyEnArgentina())) : sinDato,
    },
    {
      key: "estado_laboral",
      value: estado === "activo" || estado === "en_prueba" ? copyLaborales.estados[estado] : sinDato,
    },
    { key: "sucursal", value: item(laboral?.sucursal_id) },
    { key: "tarea", value: item(laboral?.tarea_id) },
    { key: "convenio", value: item(laboral?.convenio_id) },
    { key: "categoria", value: item(laboral?.categoria_id) },
  ];
}
