import { copy } from "@/lib/copy/es-AR";
import { copyLaborales } from "@/lib/copy/laborales";
import { esItemSistema, type CatalogoItem } from "@/lib/configuracion/listas";
import { calcularAntiguedad } from "@/lib/legajo/antiguedad";
import { ESTADOS_CIVILES } from "@/lib/legajo/options";
import { textoAntiguedad } from "@/lib/legajo/vista";
import type { Database } from "@/lib/supabase/database.types";
import { campoExportacion, type CampoExportacion, type Seleccion } from "./campos";

// The workbook of an export (CR-4), as plain data: sheets of rows of cells,
// written to .xlsx by ./xlsx.ts (server only). Pure.
// - "Legajos": one row per employee, the chosen fields in column order, with
//   the screens' labels as headers (bold, frozen).
// - "Hijos" (only when chosen): one row per child, with the employee's
//   número de legajo, apellido and nombres.
// List fields by item name (an inactive item by its plain name; with the
// "No" convenio, Tarea and Categoría empty, CR-5), dates as
// date cells (DD/MM/AAAA), CUIL as XX-XXXXXXXX-X, antigüedad as of the
// export day in Argentina. Every text cell is a string cell, neutralized
// against formula injection.

type LegajoRow = Database["public"]["Tables"]["legajos"]["Row"];
type LaboralRow = Database["public"]["Tables"]["legajos_laborales"]["Row"];

export type HijoExportable = { nombre_completo: string; fecha_nacimiento: string };
export type LegajoExportable = {
  legajo: LegajoRow;
  laboral: LaboralRow | null;
  hijos: HijoExportable[];
};

export const FORMATO_FECHA = "dd/mm/yyyy";

export type CeldaTexto = { value: string; type: StringConstructor; fontWeight?: "bold" };
export type CeldaFecha = { value: Date; type: DateConstructor; format: string };
export type Celda = CeldaTexto | CeldaFecha | null;
export type Hoja = { sheet: string; data: Celda[][]; columns: { width: number }[]; stickyRowsCount: number };

// A spreadsheet evaluates text that starts with these as a formula (or as
// the start of one, through DDE): such text gets a leading apostrophe, so it
// is shown and kept as text everywhere, even after a CSV round trip.
const INICIO_FORMULA = /^[=+\-@\t\r]/;

export function neutralizarTexto(valor: string): string {
  return INICIO_FORMULA.test(valor) ? `'${valor}` : valor;
}

export function celdaTexto(valor: string | null | undefined): CeldaTexto | null {
  if (valor === null || valor === undefined || valor === "") return null;
  return { value: neutralizarTexto(valor), type: String };
}

// A calendar date (YYYY-MM-DD) as a date cell. The date is kept as stored:
// midnight UTC, which the spreadsheet shows as that day.
export function celdaFecha(iso: string | null | undefined): CeldaFecha | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!match) return null;
  return { value: new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))), type: Date, format: FORMATO_FECHA };
}

// XX-XXXXXXXX-X for any 11 digits (stored CUILs already are); anything else
// as stored.
export function formatearCuil(cuil: string): string {
  const digitos = cuil.replace(/\D/g, "");
  return digitos.length === 11 ? `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos[10]}` : cuil;
}

const encabezado = (label: string): CeldaTexto => ({ value: label, type: String, fontWeight: "bold" });

const LISTA_DE_CAMPO = {
  area: "area_id",
  puesto: "puesto_id",
  sucursal: "sucursal_id",
  convenio: "convenio_id",
  tarea: "tarea_id",
  categoria: "categoria_id",
} as const;

// One employee's cell for a field. hoy: YYYY-MM-DD in Argentina.
// sinConvenio: the id of the "No" convenio, if any.
export function celdaDe(
  campo: CampoExportacion,
  { legajo, laboral }: LegajoExportable,
  nombres: ReadonlyMap<string, string>,
  hoy: string,
  sinConvenio: string | null = null,
): Celda {
  switch (campo) {
    case "fecha_nacimiento":
      return celdaFecha(legajo.fecha_nacimiento);
    case "cuil":
      return celdaTexto(legajo.cuil ? formatearCuil(legajo.cuil) : null);
    case "estado_civil": {
      const estado = legajo.estado_civil;
      return celdaTexto(estado && (ESTADOS_CIVILES as readonly string[]).includes(estado) ? copy.miLegajo.estadosCiviles[estado] : estado);
    }
    case "tiene_hijos":
      return legajo.tiene_hijos === null ? null : celdaTexto(legajo.tiene_hijos ? copy.miLegajo.siNo.si : copy.miLegajo.siNo.no);
    case "numero_legajo":
      return celdaTexto(laboral?.numero_legajo);
    case "fecha_ingreso":
      return celdaFecha(laboral?.fecha_ingreso);
    case "antiguedad": {
      const ingreso = laboral?.fecha_ingreso;
      return ingreso ? celdaTexto(textoAntiguedad(calcularAntiguedad(ingreso, hoy))) : null;
    }
    case "estado_laboral":
      return laboral?.estado_laboral ? celdaTexto(copyLaborales.estados[laboral.estado_laboral]) : null;
    case "tarea":
    case "categoria":
      if (sinConvenio !== null && laboral?.convenio_id === sinConvenio) return null;
      return celdaTexto(nombres.get(laboral?.[LISTA_DE_CAMPO[campo]] ?? "") ?? null);
    case "area":
    case "puesto":
    case "sucursal":
    case "convenio": {
      const id = laboral?.[LISTA_DE_CAMPO[campo]];
      return celdaTexto(id ? nombres.get(id) : null);
    }
    default:
      return celdaTexto(legajo[campo]);
  }
}

// Width in characters: the longest text in the column, within limits.
function anchos(filas: readonly Celda[][], columnas: number): { width: number }[] {
  return Array.from({ length: columnas }, (_, i) => {
    const largo = Math.max(
      ...filas.map((fila) => {
        const celda = fila[i];
        if (!celda) return 0;
        return celda.type === Date ? 10 : String(celda.value).length;
      }),
    );
    return { width: Math.min(Math.max(largo + 2, 10), 50) };
  });
}

function hoja(nombre: string, filas: Celda[][]): Hoja {
  return { sheet: nombre, data: filas, columns: anchos(filas, filas[0]?.length ?? 0), stickyRowsCount: 1 };
}

export function hojaLegajos(
  legajos: readonly LegajoExportable[],
  campos: readonly CampoExportacion[],
  nombres: ReadonlyMap<string, string>,
  hoy: string,
  sinConvenio: string | null = null,
): Hoja {
  const filas: Celda[][] = [
    campos.map((campo) => encabezado(campoExportacion(campo).label)),
    ...legajos.map((legajo) => campos.map((campo) => celdaDe(campo, legajo, nombres, hoy, sinConvenio))),
  ];
  return hoja(copy.exportacion.hojas.legajos, filas);
}

export function hojaHijos(legajos: readonly LegajoExportable[]): Hoja {
  const c = copy.aprobaciones.campos;
  const filas: Celda[][] = [
    [copyLaborales.campos.numero_legajo, c.apellido, c.nombres, copy.miLegajo.hijos.nombre, copy.miLegajo.hijos.fecha].map(encabezado),
  ];
  for (const { legajo, laboral, hijos } of legajos) {
    const ordenados = [...hijos].sort((a, b) => a.fecha_nacimiento.localeCompare(b.fecha_nacimiento));
    for (const hijo of ordenados) {
      filas.push([
        celdaTexto(laboral?.numero_legajo),
        celdaTexto(legajo.apellido),
        celdaTexto(legajo.nombres),
        celdaTexto(hijo.nombre_completo),
        celdaFecha(hijo.fecha_nacimiento),
      ]);
    }
  }
  return hoja(copy.exportacion.hojas.hijos, filas);
}

// The whole workbook. items: the Configuración lists (names by id).
export function armarLibro(legajos: readonly LegajoExportable[], seleccion: Seleccion, items: readonly CatalogoItem[], hoy: string): Hoja[] {
  const nombres = new Map(items.map((item) => [item.id, item.nombre]));
  const sinConvenio = items.find((item) => item.lista === "convenio" && esItemSistema(item))?.id ?? null;
  const hojas = [hojaLegajos(legajos, seleccion.campos, nombres, hoy, sinConvenio)];
  if (seleccion.hijos) hojas.push(hojaHijos(legajos));
  return hojas;
}

const ARCHIVO = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Buenos_Aires",
});

// legajos-AAAA-MM-DD-HHmm.xlsx, in Argentina time.
export function nombreArchivo(ahora: Date): string {
  const partes = Object.fromEntries(ARCHIVO.formatToParts(ahora).map((parte) => [parte.type, parte.value]));
  return `legajos-${partes.year}-${partes.month}-${partes.day}-${partes.hour}${partes.minute}.xlsx`;
}
