import "server-only";
import type { DocumentoTipo } from "@/lib/documentos/tipos";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { armarBandeja, type DocumentoPendienteFila, type EmpleadoFila, type ItemBandeja, type SolicitudFila } from "./bandeja";
import { totalPendientes } from "./campana";
import type { ItemSolicitud } from "./comparacion";
import type { LegajoActual } from "./solicitudes";

// Reads for /aprobaciones and the Admin's indicator, with the Admin's own
// session: an active Admin's RLS reaches every legajo, request and document.
// The pages call requireRole("admin") and the actions sessionWithRole("admin")
// before any of these. Null means the read failed.

type CuentaEstado = Database["public"]["Enums"]["cuenta_estado"];
type SolicitudEstado = Database["public"]["Enums"]["solicitud_estado"];
type DocumentoEstado = Database["public"]["Enums"]["documento_estado"];

const EMPLEADO = "profile_id, nombres, apellido, numero_legajo, profiles!inner(estado_cuenta)";

export async function cargarBandeja(adminId: string): Promise<ItemBandeja[] | null> {
  const supabase = await createClient();
  const [solicitudes, documentos] = await Promise.all([
    supabase
      .from("solicitudes_cambio")
      .select(`id, created_at, solicitudes_cambio_items (campo), legajos!inner(${EMPLEADO})`)
      .eq("estado", "pendiente"),
    supabase
      .from("legajo_documentos")
      .select(`id, tipo, created_at, legajos!inner(${EMPLEADO})`)
      .eq("estado", "pendiente"),
  ]);
  if (solicitudes.error || documentos.error) return null;
  return armarBandeja(
    (solicitudes.data ?? []) as SolicitudFila[],
    (documentos.data ?? []) as DocumentoPendienteFila[],
    adminId,
  );
}

// The number on the Admin's indicator; null when it cannot be read.
export async function contarPendientes(): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pendientes_admin");
  const fila = data?.[0];
  if (error || !fila) return null;
  return totalPendientes(fila);
}

export type Empleado = {
  profileId: string;
  nombres: string | null;
  apellido: string | null;
  numeroLegajo: string | null;
  estadoCuenta: CuentaEstado;
};

function empleadoDe(fila: EmpleadoFila): Empleado {
  return {
    profileId: fila.profile_id,
    nombres: fila.nombres,
    apellido: fila.apellido,
    numeroLegajo: fila.numero_legajo,
    estadoCuenta: fila.profiles.estado_cuenta,
  };
}

export type SolicitudBandeja = {
  id: string;
  estado: SolicitudEstado;
  enviadoEn: string;
  items: ItemSolicitud[];
  empleado: Empleado;
  // The legajo as it is now, children included.
  actual: LegajoActual;
};

// One change request with the employee's current legajo. "no-encontrado"
// when there is no such request.
export async function cargarSolicitud(id: string): Promise<SolicitudBandeja | "no-encontrado" | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("solicitudes_cambio")
    .select("id, estado, created_at, legajo_id, solicitudes_cambio_items (campo, valor_propuesto)")
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  if (!data) return "no-encontrado";

  const [legajo, hijos] = await Promise.all([
    supabase.from("legajos").select(`*, profiles!inner(estado_cuenta)`).eq("id", data.legajo_id).maybeSingle(),
    supabase
      .from("legajo_hijos")
      .select("nombre_completo, fecha_nacimiento")
      .eq("legajo_id", data.legajo_id)
      .order("fecha_nacimiento")
      .order("nombre_completo"),
  ]);
  if (legajo.error || !legajo.data || hijos.error) return null;

  const { profiles, ...fila } = legajo.data;
  return {
    id: data.id,
    estado: data.estado,
    enviadoEn: data.created_at,
    items: data.solicitudes_cambio_items.map((item) => ({ campo: item.campo, valorPropuesto: item.valor_propuesto })),
    empleado: empleadoDe({ ...fila, profiles }),
    actual: { ...fila, hijos: hijos.data ?? [] },
  };
}

export type ArchivoDocumento = {
  id: string;
  fileName: string;
  mimeType: string;
  creadoEn: string;
  // Server side only: signed URLs are made from it, it is never sent to the page.
  storagePath: string;
};

export type DocumentoBandeja = ArchivoDocumento & {
  estado: DocumentoEstado;
  tipo: DocumentoTipo;
  empleado: Empleado;
  // The approved document of the same type, if any.
  vigente: ArchivoDocumento | null;
};

const ARCHIVO = "id, file_name, mime_type, created_at, storage_path";

function archivoDe(fila: { id: string; file_name: string; mime_type: string; created_at: string; storage_path: string }): ArchivoDocumento {
  return { id: fila.id, fileName: fila.file_name, mimeType: fila.mime_type, creadoEn: fila.created_at, storagePath: fila.storage_path };
}

// One document with the approved one of its type beside it.
export async function cargarDocumento(id: string): Promise<DocumentoBandeja | "no-encontrado" | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legajo_documentos")
    .select(`${ARCHIVO}, estado, tipo, legajo_id, legajos!inner(${EMPLEADO})`)
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  if (!data) return "no-encontrado";

  const vigente = await supabase
    .from("legajo_documentos")
    .select(ARCHIVO)
    .eq("legajo_id", data.legajo_id)
    .eq("tipo", data.tipo)
    .eq("estado", "aprobado")
    .neq("id", data.id)
    .maybeSingle();
  if (vigente.error) return null;

  return {
    ...archivoDe(data),
    estado: data.estado,
    tipo: data.tipo,
    empleado: empleadoDe(data.legajos as EmpleadoFila),
    vigente: vigente.data ? archivoDe(vigente.data) : null,
  };
}
