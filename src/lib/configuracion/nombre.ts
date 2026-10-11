// Item names of the Configuración lists (PRD "Configuración"): the shared
// validator, run by the Server Actions and mirrored by the screen. The
// database enforces the same rules (migration configuracion_catalogos): the
// stored format (check catalogo_items_nombre_formato) and the uniqueness key
// (generated column clave, unique per list and, for Puesto, per Área).

export const NOMBRE_MAX = 60;

// The same letters, in the same order, as the translate() of the clave column.
const CON_ACENTO = "ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç";
const SIN_ACENTO = "AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc";
const PLIEGUE = new Map([...CON_ACENTO].map((letra, i) => [letra, SIN_ACENTO[i]]));

// Trimmed, with every run of spaces as one space: the form it is stored in.
export function normalizarNombre(nombre: string): string {
  return nombre.replace(/\s+/g, " ").trim();
}

// The comparison key: accents folded, lower case.
export function claveNombre(nombre: string): string {
  return [...normalizarNombre(nombre)].map((letra) => PLIEGUE.get(letra) ?? letra).join("").toLowerCase();
}

export type ErrorNombre = "vacio" | "largo" | "duplicado";

export type NombreValidado = { ok: true; nombre: string } | { ok: false; error: ErrorNombre };

// existentes: the other names of the same list (of the same Área, for a
// Puesto), without the item being renamed.
export function validarNombre(entrada: unknown, existentes: readonly string[]): NombreValidado {
  const nombre = normalizarNombre(typeof entrada === "string" ? entrada : "");
  if (nombre === "") return { ok: false, error: "vacio" };
  if ([...nombre].length > NOMBRE_MAX) return { ok: false, error: "largo" };
  const clave = claveNombre(nombre);
  if (existentes.some((otro) => claveNombre(otro) === clave)) return { ok: false, error: "duplicado" };
  return { ok: true, nombre };
}
