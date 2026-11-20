import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionResult } from "@/lib/action-result";
import { listarCuentas } from "@/lib/admin/cuentas";
import { sessionWithRole } from "@/lib/auth/require-role";
import { nombreCompleto } from "@/lib/cuentas/listado";
import { copyRecibos, type EstadoFirmaFila } from "@/lib/copy/recibos";
import { fechaYHora } from "@/lib/format/fecha";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { nombreVisible, ordenarPersonas } from "./carga-datos";
import { crearUrlFirmadaFirma, crearUrlFirmadaRecibo } from "./signed-url";

// Estado de firmas (F2-06, PRD Fase 2 RF-19 to RF-22), Admin only.
//
// Every read goes through the Admin's session client, so RLS decides (an
// active Admin reads every receipt, history row, override and signature).
// The loaders check for an active Admin themselves before reading, on top of
// the page's requireRole and the route guard, and answer null when refused or
// when a read fails. Never a raw id on screen: people are shown by the
// legajo's name, else the account's email, else the fallback copy (RF-21).
// Emails exist only in Auth, so they are looked up, only for whoever has no
// name, through the account module (listarCuentas), as Carga de recibos does.
// Ids leave this module only as handles for the Admin's own actions.
//
// Bounded reads: a period's lists are bounded by its employees; a receipt's
// detail by its own rows; the Legajos count pages through the pending
// receipts of visible periods (PAGINA rows per request), reading one column.

type Client = SupabaseClient<Database>;
type ReciboEstado = Database["public"]["Enums"]["recibo_estado"];
type PeriodoEstado = Database["public"]["Enums"]["recibo_periodo_estado"];
type MotivoOverride = Database["public"]["Enums"]["recibo_override_motivo"];

const LOG = "[recibos-estado]";
const e = copyRecibos.estado.errors;
export const PAGINA = 1000;
// Visible to employees (decision 7): drafts never count.
export const PERIODOS_VISIBLES: readonly PeriodoEstado[] = ["publicado", "cerrado"];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// "dd/mm/aaaa HH:mm", Argentina time; null stays null.
export function fechaHoraCorta(iso: string | null): string | null {
  if (!iso) return null;
  const { fecha, hora } = fechaYHora(iso);
  return fecha ? `${fecha} ${hora}` : null;
}

export function estadoFirmaDe(recibo: { estado: ReciboEstado } | undefined): EstadoFirmaFila {
  if (!recibo) return "sin_recibo";
  return recibo.estado === "firmado" ? "firmado" : "pendiente";
}

export type Conteos = Record<EstadoFirmaFila, number>;

export function contarEstados(filas: readonly { estado: EstadoFirmaFila }[]): Conteos {
  const conteos: Conteos = { firmado: 0, pendiente: 0, sin_recibo: 0 };
  for (const fila of filas) conteos[fila.estado] += 1;
  return conteos;
}

// Letters and digits only (accents dropped, anything else a single "-"), so
// the name is safe in a Content-Disposition header on every system.
export function parteAscii(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Recibo-{Apellido}-{MM}-{AAAA}.pdf; a replaced file adds -reemplazado-{n}
// (n: 1 for the first file replaced). Without a surname: Recibo-{MM}-{AAAA}.
export function nombreArchivoRecibo(input: { apellido: string | null; mes: number; anio: number; reemplazo?: number }): string {
  const partes = ["Recibo", parteAscii(input.apellido), String(input.mes).padStart(2, "0"), String(input.anio)].filter(Boolean);
  const sufijo = input.reemplazo === undefined ? "" : `-reemplazado-${input.reemplazo}`;
  return `${partes.join("-")}${sufijo}.pdf`;
}

export type Persona = { id: string; nombres: string | null; apellido: string | null; email: string | null };

// Ids to shown names, by the display rule; an id with no data gets the
// fallback copy.
export function mapaDeNombres(ids: readonly string[], personas: readonly Persona[]): Map<string, string> {
  const porId = new Map(personas.map((persona) => [persona.id, persona]));
  return new Map(
    ids.map((id) => [id, nombreVisible(porId.get(id) ?? { id, nombres: null, apellido: null, email: null })]),
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

// The legajo's names for the ids, with the account email for whoever has no
// name (one account lookup, only when needed). Null when the legajo read fails.
async function personasDe(client: Client, ids: readonly string[]): Promise<Persona[] | null> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return [];
  const legajos = await client.from("legajos").select("profile_id, nombres, apellido").in("profile_id", unicos);
  if (legajos.error) return null;
  const porPerfil = new Map((legajos.data ?? []).map((legajo) => [legajo.profile_id, legajo]));

  let emails = new Map<string, string>();
  const sinNombre = unicos.some((id) => !nombreCompleto(porPerfil.get(id)?.nombres ?? null, porPerfil.get(id)?.apellido ?? null));
  if (sinNombre) {
    const cuentas = await listarCuentas();
    if (cuentas.ok) emails = new Map((cuentas.data ?? []).map((cuenta) => [cuenta.id, cuenta.email]));
    else console.error(`${LOG} account lookup failed; unnamed people shown with the fallback`);
  }
  return unicos.map((id) => ({
    id,
    nombres: porPerfil.get(id)?.nombres ?? null,
    apellido: porPerfil.get(id)?.apellido ?? null,
    email: emails.get(id) || null,
  }));
}

// ---------------------------------------------------------------------------
// Estado de firmas of a period (RF-19, decision 6)
// ---------------------------------------------------------------------------
export type FilaEstado = {
  // Handles only (React key, the Detalle link); never shown.
  empleadoId: string;
  reciboId: string | null;
  nombre: string;
  // A deactivated account that has a receipt in the period.
  inactiva: boolean;
  estado: EstadoFirmaFila;
  // dd/mm/aaaa HH:mm.
  firmadoAt: string | null;
  cargadoAt: string | null;
};

export type EstadoPeriodo = { filas: FilaEstado[]; conteos: Conteos };

type ReciboFila = { id: string; empleado_id: string; estado: ReciboEstado; firmado_at: string | null; cargado_at: string };

// Rows: every active Empleado, plus every account with a receipt in the
// period even if it is no longer active (tagged), so no receipt is hidden.
export function armarFilas(
  activos: readonly string[],
  recibos: readonly ReciboFila[],
  inactivas: ReadonlySet<string>,
  personas: readonly Persona[],
): FilaEstado[] {
  const reciboDe = new Map(recibos.map((recibo) => [recibo.empleado_id, recibo]));
  const ids = new Set([...activos, ...recibos.map((recibo) => recibo.empleado_id)]);
  const porId = new Map(personas.map((persona) => [persona.id, persona]));
  const ordenadas = ordenarPersonas(
    [...ids].map((id) => porId.get(id) ?? { id, nombres: null, apellido: null, email: null }),
  );
  return ordenadas.map((persona) => {
    const recibo = reciboDe.get(persona.id);
    return {
      empleadoId: persona.id,
      reciboId: recibo?.id ?? null,
      nombre: nombreVisible(persona),
      inactiva: recibo !== undefined && inactivas.has(persona.id),
      estado: estadoFirmaDe(recibo),
      firmadoAt: recibo?.estado === "firmado" ? fechaHoraCorta(recibo.firmado_at) : null,
      cargadoAt: fechaHoraCorta(recibo?.cargado_at ?? null),
    };
  });
}

export async function cargarEstadoPeriodo(periodoId: string): Promise<EstadoPeriodo | null> {
  if (!(await sessionWithRole("admin"))) return null;
  const client = await createClient();
  // Only Empleado accounts take part in receipts (PRD Fase 2 RF-05,
  // decision 1): the owner's role is filtered in the query itself, so a
  // receipt owned by any other role never becomes a row.
  const [perfiles, recibos] = await Promise.all([
    client.from("profiles").select("id").eq("role", "empleado").eq("estado_cuenta", "activa"),
    client
      .from("recibos")
      .select("id, empleado_id, estado, firmado_at, cargado_at, profiles!recibos_empleado_id_fkey!inner(role, estado_cuenta)")
      .eq("periodo_id", periodoId)
      .eq("profiles.role", "empleado"),
  ]);
  if (perfiles.error || recibos.error) return null;
  const activos = (perfiles.data ?? []).map((perfil) => perfil.id);
  const activosSet = new Set(activos);
  const filasRecibo = recibos.data ?? [];

  // Empleados with a receipt here that are not active now (tagged).
  const otros = [...new Set(filasRecibo.map((r) => r.empleado_id).filter((id) => !activosSet.has(id)))];
  const inactivas = new Set<string>();
  for (const recibo of filasRecibo) {
    if (!activosSet.has(recibo.empleado_id) && recibo.profiles?.estado_cuenta !== "activa") inactivas.add(recibo.empleado_id);
  }

  const personas = await personasDe(client, [...activos, ...otros]);
  if (!personas) return null;
  const filas = armarFilas(activos, filasRecibo, inactivas, personas);
  return { filas, conteos: contarEstados(filas) };
}

// ---------------------------------------------------------------------------
// Detalle of a receipt (RF-20, decision 8)
// ---------------------------------------------------------------------------
export type DetalleRecibo = {
  reciboId: string;
  nombre: string;
  periodo: { anio: number; mes: number; estado: PeriodoEstado };
  actual: { estado: ReciboEstado; cargadoAt: string | null; cargadoPor: string };
  // The signature evidence of the current file, when signed.
  firma: { firmadoAt: string | null; version: number | null; firmaId: string | null } | null;
  // Newest first.
  overrides: { clave: string; motivo: MotivoOverride; quien: string; cuando: string | null }[];
  // Newest first; numero counts from the oldest (1).
  reemplazos: {
    historialId: string;
    numero: number;
    quien: string;
    cuando: string | null;
    estadoAlReemplazo: ReciboEstado;
    firmadoAt: string | null;
    cargadoAt: string | null;
  }[];
};

type ReciboDetalle = {
  id: string;
  empleado_id: string;
  estado: ReciboEstado;
  cargado_at: string;
  cargado_por: string;
  firmado_at: string | null;
  firma_id: string | null;
  recibo_periodos: { anio: number; mes: number; estado: PeriodoEstado } | null;
};
type Evidencia = { firmado_at: string; firma_id: string };
type Override = { id: string; motivo: MotivoOverride; admin_id: string; created_at: string };
type Historial = {
  id: string;
  reemplazado_at: string;
  reemplazado_por: string;
  estado_al_reemplazo: ReciboEstado;
  firmado_at: string | null;
  cargado_at: string;
};

// Pure: the detail from the rows read. evidencias newest first; historial
// oldest first; versiones by signature id.
export function armarDetalle(
  recibo: ReciboDetalle & { recibo_periodos: NonNullable<ReciboDetalle["recibo_periodos"]> },
  evidencias: readonly Evidencia[],
  overrides: readonly Override[],
  historial: readonly Historial[],
  versiones: ReadonlyMap<string, number>,
  nombres: ReadonlyMap<string, string>,
): DetalleRecibo {
  const nombre = (id: string) => nombres.get(id) ?? copyRecibos.usuarioNoDisponible;
  let firma: DetalleRecibo["firma"] = null;
  if (recibo.estado === "firmado") {
    // The evidence row of the current signature (append-only), else the row.
    const evidencia = evidencias.find((ev) => ev.firma_id === recibo.firma_id) ?? null;
    const firmaId = evidencia?.firma_id ?? recibo.firma_id;
    firma = {
      firmadoAt: fechaHoraCorta(evidencia?.firmado_at ?? recibo.firmado_at),
      version: firmaId ? (versiones.get(firmaId) ?? null) : null,
      firmaId,
    };
  }
  return {
    reciboId: recibo.id,
    nombre: nombre(recibo.empleado_id),
    periodo: recibo.recibo_periodos,
    actual: { estado: recibo.estado, cargadoAt: fechaHoraCorta(recibo.cargado_at), cargadoPor: nombre(recibo.cargado_por) },
    firma,
    overrides: overrides.map((o) => ({ clave: o.id, motivo: o.motivo, quien: nombre(o.admin_id), cuando: fechaHoraCorta(o.created_at) })),
    reemplazos: historial
      .map((h, i) => ({
        historialId: h.id,
        numero: i + 1,
        quien: nombre(h.reemplazado_por),
        cuando: fechaHoraCorta(h.reemplazado_at),
        estadoAlReemplazo: h.estado_al_reemplazo,
        firmadoAt: h.estado_al_reemplazo === "firmado" ? fechaHoraCorta(h.firmado_at) : null,
        cargadoAt: fechaHoraCorta(h.cargado_at),
      }))
      .reverse(),
  };
}

// The receipt's history rows, oldest first (the order the files are numbered in).
function historialDe(client: Client, reciboId: string) {
  return client
    .from("recibo_historial")
    .select("id, reemplazado_at, reemplazado_por, estado_al_reemplazo, firmado_at, cargado_at")
    .eq("recibo_id", reciboId)
    .order("reemplazado_at", { ascending: true })
    .order("id", { ascending: true });
}

export async function cargarDetalleRecibo(reciboId: string): Promise<DetalleRecibo | null> {
  if (!(await sessionWithRole("admin"))) return null;
  const client = await createClient();
  const leido = await client
    .from("recibos")
    .select("id, empleado_id, estado, cargado_at, cargado_por, firmado_at, firma_id, recibo_periodos(anio, mes, estado)")
    .eq("id", reciboId)
    .maybeSingle();
  if (leido.error || !leido.data) return null;
  const recibo = leido.data as ReciboDetalle;
  if (!recibo.recibo_periodos) return null;

  const [evidencias, overrides, historial] = await Promise.all([
    client.from("recibo_firmas").select("firmado_at, firma_id").eq("recibo_id", reciboId).order("firmado_at", { ascending: false }),
    client
      .from("recibo_overrides")
      .select("id, motivo, admin_id, created_at")
      .eq("recibo_id", reciboId)
      .order("created_at", { ascending: false }),
    historialDe(client, reciboId),
  ]);
  if (evidencias.error || overrides.error || historial.error) return null;

  const firmaIds = [...new Set([recibo.firma_id, ...(evidencias.data ?? []).map((ev) => ev.firma_id)].filter((id): id is string => Boolean(id)))];
  const versiones = new Map<string, number>();
  if (firmaIds.length > 0) {
    const firmas = await client.from("firmas_empleado").select("id, version").in("id", firmaIds);
    if (firmas.error) return null;
    for (const firma of firmas.data ?? []) versiones.set(firma.id, firma.version);
  }

  const actores = [
    recibo.empleado_id,
    recibo.cargado_por,
    ...(overrides.data ?? []).map((o) => o.admin_id),
    ...(historial.data ?? []).map((h) => h.reemplazado_por),
  ];
  const personas = await personasDe(client, actores);
  if (!personas) return null;
  return armarDetalle(
    { ...recibo, recibo_periodos: recibo.recibo_periodos },
    evidencias.data ?? [],
    overrides.data ?? [],
    historial.data ?? [],
    versiones,
    mapaDeNombres(actores, personas),
  );
}

// ---------------------------------------------------------------------------
// "Recibos sin firmar" on Legajos (RF-22, decision 7)
// ---------------------------------------------------------------------------

// Distinct employees with at least one pending receipt in a published or
// closed period, any period, deactivated accounts included. Paged by id.
// Only Empleado owners count (PRD Fase 2 RF-05, decision 1), filtered in
// the query.
export async function contarEmpleadosConRecibosSinFirmar(): Promise<number | null> {
  if (!(await sessionWithRole("admin"))) return null;
  const client = await createClient();
  const empleados = new Set<string>();
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await client
      .from("recibos")
      .select("id, empleado_id, recibo_periodos!inner(estado), profiles!recibos_empleado_id_fkey!inner(role)")
      .eq("estado", "pendiente")
      .in("recibo_periodos.estado", [...PERIODOS_VISIBLES])
      .eq("profiles.role", "empleado")
      .order("id", { ascending: true })
      .range(desde, desde + PAGINA - 1);
    if (error) return null;
    for (const fila of data ?? []) empleados.add(fila.empleado_id);
    if ((data ?? []).length < PAGINA) return empleados.size;
  }
}

// ---------------------------------------------------------------------------
// Files and signature images (the /recibos/estado Server Actions)
// ---------------------------------------------------------------------------
// Called only after the action's guard and strict schema. The row is read
// with the session client and the 5-minute link is signed with it too, so
// the storage policy decides. No path leaves the server.

export type ArchivoAdmin = { origen: "actual" | "historial"; id: string; modo: "ver" | "descargar" };

const fallo = (error: string): { ok: false; error: string } => ({ ok: false, error });

type Ubicado = { path: string; empleadoId: string; periodo: { anio: number; mes: number }; reemplazo?: number };

async function ubicarArchivo(client: Client, input: ArchivoAdmin): Promise<Ubicado | null> {
  if (input.origen === "actual") {
    const { data, error } = await client
      .from("recibos")
      .select("archivo_path, empleado_id, recibo_periodos(anio, mes)")
      .eq("id", input.id)
      .maybeSingle();
    if (error || !data?.recibo_periodos) return null;
    return { path: data.archivo_path, empleadoId: data.empleado_id, periodo: data.recibo_periodos };
  }
  const { data, error } = await client
    .from("recibo_historial")
    .select("archivo_path, empleado_id, recibo_id, recibo_periodos(anio, mes)")
    .eq("id", input.id)
    .maybeSingle();
  if (error || !data?.recibo_periodos) return null;
  const hermanos = await client
    .from("recibo_historial")
    .select("id")
    .eq("recibo_id", data.recibo_id)
    .order("reemplazado_at", { ascending: true })
    .order("id", { ascending: true });
  if (hermanos.error) return null;
  const indice = (hermanos.data ?? []).findIndex((h) => h.id === input.id);
  if (indice < 0) return null;
  return { path: data.archivo_path, empleadoId: data.empleado_id, periodo: data.recibo_periodos, reemplazo: indice + 1 };
}

export async function urlArchivoAdmin(client: Client, input: ArchivoAdmin): Promise<ActionResult<{ url: string }>> {
  const archivo = await ubicarArchivo(client, input);
  if (!archivo) return fallo(e.verFallo);
  let download: string | undefined;
  if (input.modo === "descargar") {
    const legajo = await client.from("legajos").select("apellido").eq("profile_id", archivo.empleadoId).maybeSingle();
    if (legajo.error) return fallo(e.verFallo);
    download = nombreArchivoRecibo({
      apellido: legajo.data?.apellido ?? null,
      ...archivo.periodo,
      ...(archivo.reemplazo === undefined ? {} : { reemplazo: archivo.reemplazo }),
    });
  }
  const url = await crearUrlFirmadaRecibo(archivo.path, download ? { download } : {});
  return url.ok ? { ok: true, data: { url: url.url } } : fallo(e.verFallo);
}

export async function urlFirmaAdmin(client: Client, firmaId: string): Promise<ActionResult<{ url: string }>> {
  const { data, error } = await client.from("firmas_empleado").select("imagen_path").eq("id", firmaId).maybeSingle();
  if (error || !data) return fallo(e.firmaFallo);
  const url = await crearUrlFirmadaFirma(data.imagen_path);
  return url.ok ? { ok: true, data: { url: url.url } } : fallo(e.firmaFallo);
}
