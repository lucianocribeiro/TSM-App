import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionResult } from "@/lib/action-result";
import { listarItems } from "@/lib/configuracion/datos";
import { copy } from "@/lib/copy/es-AR";
import { hoyEnArgentina } from "@/lib/legajo/fechas";
import { filtrarLegajos, itemDesdeFila, type FiltrosLegajos } from "@/lib/legajo/listado";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { validarSeleccion, type Seleccion } from "./campos";
import { validarFiltros } from "./filtros";
import { armarLibro, nombreArchivo, type LegajoExportable } from "./planilla";
import { escribirXlsx } from "./xlsx";

// The Excel export of the Legajos list (CR-4), with the Admin's own session
// (the action has already checked the caller is an active Admin; RLS and
// registrar_exportacion check again). Only the list state and the field keys
// come from the browser, each checked against its allow-list; the rows are
// read again here and filtered with the list's own rules. The file is built
// in memory and returned, never stored. Every export is logged in the same
// request: if the log cannot be written, the file is not returned.
// Server logs carry no personal data: no names, ids, search text or values.

type Client = SupabaseClient<Database>;
export type ArchivoExportado = { nombre: string; contenido: string };

const errors = copy.exportacion.errors;
const ORIGEN = "[legajos/exportacion]";

async function registrar(
  client: Client,
  seleccion: Seleccion,
  filtros: FiltrosLegajos,
  cantidad: number,
  resultado: "ok" | "error",
): Promise<boolean> {
  const { error } = await client.rpc("registrar_exportacion", {
    p_campos: seleccion.campos,
    p_incluye_hijos: seleccion.hijos,
    p_cantidad: cantidad,
    p_filtros: filtros,
    p_resultado: resultado,
  });
  return !error;
}

// The employees the list shows for these filters, in its order, with every
// column the export may need.
async function leerLegajos(client: Client, filtros: FiltrosLegajos) {
  const [{ data, error }, items] = await Promise.all([
    client
      .from("legajos")
      .select("*, legajos_laborales(*), profiles!inner(estado_cuenta), legajo_hijos(nombre_completo, fecha_nacimiento)"),
    listarItems(client),
  ]);
  if (error || !items) return null;
  const porPerfil = new Map<string, LegajoExportable>();
  const lista = (data ?? []).map(({ legajos_laborales, profiles, legajo_hijos, ...legajo }) => {
    porPerfil.set(legajo.profile_id, { legajo, laboral: legajos_laborales, hijos: legajo_hijos ?? [] });
    return itemDesdeFila({ ...legajo, laboral: legajos_laborales, estado_cuenta: profiles.estado_cuenta }, items);
  });
  const legajos = filtrarLegajos(lista, filtros).map((item) => porPerfil.get(item.profileId)!);
  return { legajos, items };
}

export async function exportarLegajos(input: unknown, ahora: Date = new Date()): Promise<ActionResult<ArchivoExportado>> {
  const pedido = (input ?? {}) as { filtros?: unknown; seleccion?: unknown };
  const filtros = validarFiltros(pedido.filtros);
  const seleccion = validarSeleccion(pedido.seleccion);
  if (!filtros || !seleccion) return { ok: false, error: errors.seleccion };

  const client = await createClient();
  const leidos = await leerLegajos(client, filtros);
  if (!leidos) return { ok: false, error: errors.fallo };
  if (leidos.legajos.length === 0) return { ok: false, error: errors.sinEmpleados };
  const cantidad = leidos.legajos.length;

  let archivo: Buffer;
  try {
    archivo = await escribirXlsx(armarLibro(leidos.legajos, seleccion, leidos.items, hoyEnArgentina(ahora)));
  } catch {
    // The failed attempt is logged too, when possible.
    if (!(await registrar(client, seleccion, filtros, cantidad, "error"))) console.error(`${ORIGEN} export log failed`);
    console.error(`${ORIGEN} workbook could not be written`);
    return { ok: false, error: errors.fallo };
  }

  if (!(await registrar(client, seleccion, filtros, cantidad, "ok"))) {
    console.error(`${ORIGEN} export log failed; export refused`);
    return { ok: false, error: errors.fallo };
  }
  return { ok: true, data: { nombre: nombreArchivo(ahora), contenido: archivo.toString("base64") } };
}
