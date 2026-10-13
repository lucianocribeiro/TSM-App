"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { sessionWithRole } from "@/lib/auth/require-role";
import { mensajeBase, mensajeNombre } from "@/lib/configuracion/errores";
import { LISTAS, type CatalogoLista } from "@/lib/configuracion/listas";
import { validarNombre } from "@/lib/configuracion/nombre";
import { copy } from "@/lib/copy/es-AR";
import { createClient } from "@/lib/supabase/server";

// Server Actions of /configuracion (PRD "Configuración"). Admin only: each
// one checks for an active Admin first (sessionWithRole) and then runs with
// the Admin's own session, so RLS (Admin only) and the table's constraints
// apply as well. Every change but an addition carries the version the
// screen showed; a stale one is refused as a concurrent change. The history
// is written by the database (trigger), not here. The "No" convenio is a
// system item (CR-5): renaming, deactivating and deleting it are refused
// here and by the database.

const errors = copy.configuracion.errors;
const noAutorizado = { ok: false as const, error: copy.cuentas.errors.noAutorizado };
const fallo = (error: string) => ({ ok: false as const, error });

const CONFIGURACION_PATH = "/configuracion";

const id = z.uuid();
const version = z.number().int().positive();

const agregarInput = z.object({ lista: z.enum(LISTAS), areaId: z.uuid().nullish(), nombre: z.string() });
const renombrarInput = z.object({ id, version, nombre: z.string() });
const itemInput = z.object({ id, version });
const moverInput = z.object({ id, version, direccion: z.enum(["arriba", "abajo"]) });
const sucursalDefectoInput = z.object({ id, version, sucursalId: z.uuid().nullable() });

async function run<S extends z.ZodType>(
  schema: S,
  input: unknown,
  operation: (data: z.infer<S>) => Promise<ActionResult>,
): Promise<ActionResult> {
  if (!(await sessionWithRole("admin"))) return noAutorizado;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fallo(errors.accionFallo);
  const result = await operation(parsed.data);
  if (result.ok) revalidatePath(CONFIGURACION_PATH, "layout");
  return result;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

// The names of a list (of an Área, for Puesto), for the duplicate check.
async function nombresDelGrupo(supabase: Supabase, lista: CatalogoLista, areaId: string | null, sinId?: string) {
  let consulta = supabase.from("catalogo_items").select("id, nombre").eq("lista", lista);
  consulta = areaId === null ? consulta.is("area_id", null) : consulta.eq("area_id", areaId);
  const { data, error } = await consulta;
  if (error) return null;
  return (data ?? []).filter((item) => item.id !== sinId).map((item) => item.nombre);
}

// True when the item is the system "No" convenio, null when it cannot be read.
async function esSistema(supabase: Supabase, itemId: string): Promise<boolean | null> {
  const { data, error } = await supabase.from("catalogo_items").select("sin_convenio").eq("id", itemId).maybeSingle();
  if (error) return null;
  return data?.sin_convenio === true;
}

// The refusal for a system item, or null to go on (a missing item is left
// to the write, which reports it).
async function rechazoSistema(supabase: Supabase, itemId: string): Promise<ActionResult | null> {
  const sistema = await esSistema(supabase, itemId);
  if (sistema === null) return fallo(errors.accionFallo);
  return sistema ? fallo(errors.itemSistema) : null;
}

// After a write that matched no row: the item is gone, or its version moved on.
async function sinFilas(supabase: Supabase, itemId: string): Promise<ActionResult> {
  const { data } = await supabase.from("catalogo_items").select("id").eq("id", itemId).maybeSingle();
  return fallo(data ? errors.cambioConcurrente : errors.noEncontrado);
}

// A new item, at the end of its list (of its Área, for a Puesto).
export async function agregarItem(input: unknown): Promise<ActionResult> {
  return run(agregarInput, input, async ({ lista, areaId, nombre }) => {
    const area = areaId ?? null;
    if ((lista === "puesto") !== (area !== null)) return fallo(lista === "puesto" ? errors.areaInvalida : errors.accionFallo);

    const supabase = await createClient();
    if (area !== null) {
      const { data } = await supabase.from("catalogo_items").select("id").eq("id", area).eq("lista", "area").maybeSingle();
      if (!data) return fallo(errors.areaInvalida);
    }
    const existentes = await nombresDelGrupo(supabase, lista, area);
    if (!existentes) return fallo(errors.accionFallo);
    const validado = validarNombre(nombre, existentes);
    if (!validado.ok) return fallo(mensajeNombre(validado.error, lista));

    const { error } = await supabase.from("catalogo_items").insert({ lista, area_id: area, nombre: validado.nombre });
    if (error) return fallo(error.code === "23503" ? errors.areaInvalida : mensajeBase(error, lista));
    return { ok: true };
  });
}

export async function renombrarItem(input: unknown): Promise<ActionResult> {
  return run(renombrarInput, input, async ({ id: itemId, version: vista, nombre }) => {
    const supabase = await createClient();
    const { data: item } = await supabase
      .from("catalogo_items")
      .select("id, lista, area_id, nombre, version, sin_convenio")
      .eq("id", itemId)
      .maybeSingle();
    if (!item) return fallo(errors.noEncontrado);
    if (item.sin_convenio) return fallo(errors.itemSistema);
    if (item.version !== vista) return fallo(errors.cambioConcurrente);

    const existentes = await nombresDelGrupo(supabase, item.lista, item.area_id, item.id);
    if (!existentes) return fallo(errors.accionFallo);
    const validado = validarNombre(nombre, existentes);
    if (!validado.ok) return fallo(mensajeNombre(validado.error, item.lista));
    if (validado.nombre === item.nombre) return { ok: true };

    const { data, error } = await supabase
      .from("catalogo_items")
      .update({ nombre: validado.nombre })
      .eq("id", item.id)
      .eq("version", vista)
      .select("id");
    if (error) return fallo(mensajeBase(error, item.lista));
    if (!data?.length) return sinFilas(supabase, item.id);
    return { ok: true };
  });
}

async function cambiarEstado(itemId: string, vista: number, activo: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  if (!activo) {
    const rechazo = await rechazoSistema(supabase, itemId);
    if (rechazo) return rechazo;
  }
  const { data, error } = await supabase
    .from("catalogo_items")
    .update({ activo })
    .eq("id", itemId)
    .eq("version", vista)
    .select("id");
  if (error) return fallo(mensajeBase(error, null));
  if (!data?.length) return sinFilas(supabase, itemId);
  return { ok: true };
}

// Hidden from new selections; records that have it keep it. For an Área, its
// Puestos are hidden too, without changing their own state.
export async function desactivarItem(input: unknown): Promise<ActionResult> {
  return run(itemInput, input, ({ id: itemId, version: vista }) => cambiarEstado(itemId, vista, false));
}

export async function reactivarItem(input: unknown): Promise<ActionResult> {
  return run(itemInput, input, ({ id: itemId, version: vista }) => cambiarEstado(itemId, vista, true));
}

// One place up or down; the database swaps it with its neighbour under the
// list's lock (mover_catalogo_item).
export async function moverItem(input: unknown): Promise<ActionResult> {
  return run(moverInput, input, async ({ id: itemId, version: vista, direccion }) => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("mover_catalogo_item", { p_item_id: itemId, p_version: vista, p_direccion: direccion });
    if (error) return fallo(mensajeBase(error, null));
    return { ok: true };
  });
}

// Only an item never used: the database refuses one in use (foreign keys,
// ON DELETE RESTRICT), and the screen offers it only when unused.
export async function eliminarItem(input: unknown): Promise<ActionResult> {
  return run(itemInput, input, async ({ id: itemId, version: vista }) => {
    const supabase = await createClient();
    const rechazo = await rechazoSistema(supabase, itemId);
    if (rechazo) return rechazo;
    const { data, error } = await supabase.from("catalogo_items").delete().eq("id", itemId).eq("version", vista).select("id");
    if (error) return fallo(mensajeBase(error, null));
    if (!data?.length) return sinFilas(supabase, itemId);
    return { ok: true };
  });
}

// A Puesto's Sucursal por defecto (CR-5), or none (null). A newly chosen
// Sucursal must be active; the one the Puesto already has stays valid. The
// database checks the same (catalogo_items_reglas) and records the change.
export async function asignarSucursalDefecto(input: unknown): Promise<ActionResult> {
  return run(sucursalDefectoInput, input, async ({ id: itemId, version: vista, sucursalId }) => {
    const supabase = await createClient();
    const { data: item } = await supabase
      .from("catalogo_items")
      .select("id, lista, version, sucursal_defecto_id")
      .eq("id", itemId)
      .maybeSingle();
    if (!item) return fallo(errors.noEncontrado);
    if (item.lista !== "puesto") return fallo(errors.accionFallo);
    if (item.version !== vista) return fallo(errors.cambioConcurrente);
    if (sucursalId === item.sucursal_defecto_id) return { ok: true };

    if (sucursalId !== null) {
      const { data: sucursal } = await supabase
        .from("catalogo_items")
        .select("id")
        .eq("id", sucursalId)
        .eq("lista", "sucursal")
        .eq("activo", true)
        .maybeSingle();
      if (!sucursal) return fallo(errors.sucursalInvalida);
    }

    const { data, error } = await supabase
      .from("catalogo_items")
      .update({ sucursal_defecto_id: sucursalId })
      .eq("id", item.id)
      .eq("version", vista)
      .select("id");
    if (error) return fallo(error.code === "23503" ? errors.sucursalInvalida : mensajeBase(error, null));
    if (!data?.length) return sinFilas(supabase, item.id);
    return { ok: true };
  });
}
