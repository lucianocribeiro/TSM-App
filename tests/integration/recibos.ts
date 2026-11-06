import { randomInt, randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/database.types";
import type { TypedClient } from "./helpers";

// Receipts fixtures (F2-02), written with the service role. There are no
// write functions yet (F2-04, F2-05), so tests set every state directly.
//
// Retention by design: evidence, logs and registered signatures cannot be
// deleted (guard triggers, even for the service role), and every foreign key
// to profiles is ON DELETE RESTRICT. An account that ends up with any of
// those rows cannot be removed afterwards, so deleteTestUsers (which ignores
// errors) leaves it in the local test database. Receipts and periods without
// evidence or history are removed by the tests that create them.

type PeriodoEstado = Database["public"]["Enums"]["recibo_periodo_estado"];

const UNIQUE_VIOLATION = "23505";

// A period in a month no other test uses: random (anio, mes), again on a
// clash with the unique key.
export async function nuevoPeriodo(service: TypedClient, creadoPor: string, estado: PeriodoEstado = "borrador") {
  const ahora = new Date().toISOString();
  for (let intento = 0; intento < 50; intento++) {
    const { data, error } = await service
      .from("recibo_periodos")
      .insert({
        anio: randomInt(2000, 2101),
        mes: randomInt(1, 13),
        estado,
        created_by: creadoPor,
        publicado_at: estado === "borrador" ? null : ahora,
        publicado_por: estado === "borrador" ? null : creadoPor,
        cerrado_at: estado === "cerrado" ? ahora : null,
        cerrado_por: estado === "cerrado" ? creadoPor : null,
      })
      .select("id, anio, mes")
      .single();
    if (data) return data;
    if (error?.code !== UNIQUE_VIOLATION) throw new Error(`period setup failed: ${error?.message}`);
  }
  throw new Error("period setup failed: no free month");
}

export async function ponerEstadoPeriodo(service: TypedClient, periodoId: string, estado: PeriodoEstado, actor: string) {
  const ahora = new Date().toISOString();
  const { error } = await service
    .from("recibo_periodos")
    .update({
      estado,
      publicado_at: estado === "borrador" ? null : ahora,
      publicado_por: estado === "borrador" ? null : actor,
      cerrado_at: estado === "cerrado" ? ahora : null,
      cerrado_por: estado === "cerrado" ? actor : null,
    })
    .eq("id", periodoId);
  if (error) throw new Error(`period state failed: ${error.message}`);
}

export async function nuevoRecibo(service: TypedClient, periodoId: string, empleadoId: string, cargadoPor: string) {
  const { data, error } = await service
    .from("recibos")
    .insert({
      periodo_id: periodoId,
      empleado_id: empleadoId,
      archivo_path: `${empleadoId}/${periodoId}/${randomUUID()}.pdf`,
      archivo_bytes: 1024,
      cargado_por: cargadoPor,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`receipt setup failed: ${error?.message}`);
  return data.id;
}

// The employee's next signature version, active (the previous one retired).
export async function nuevaFirma(service: TypedClient, empleadoId: string) {
  const { data: previas } = await service
    .from("firmas_empleado")
    .select("id, version, activa")
    .eq("empleado_id", empleadoId)
    .order("version", { ascending: false });
  const activa = previas?.find((firma) => firma.activa);
  if (activa) {
    const { error } = await service.from("firmas_empleado").update({ activa: false }).eq("id", activa.id);
    if (error) throw new Error(`signature retire failed: ${error.message}`);
  }
  const version = (previas?.[0]?.version ?? 0) + 1;
  const { data, error } = await service
    .from("firmas_empleado")
    .insert({ empleado_id: empleadoId, version, imagen_path: `${empleadoId}/firma-${version}.png`, activa: true })
    .select("id")
    .single();
  if (error || !data) throw new Error(`signature setup failed: ${error?.message}`);
  return data.id;
}

// Signs a receipt as F2-05 will: the receipt and its evidence row.
export async function firmarRecibo(service: TypedClient, reciboId: string, empleadoId: string, firmaId: string) {
  const firmadoAt = new Date().toISOString();
  const firmado = await service
    .from("recibos")
    .update({ estado: "firmado", firmado_at: firmadoAt, firma_id: firmaId })
    .eq("id", reciboId);
  if (firmado.error) throw new Error(`receipt sign failed: ${firmado.error.message}`);
  const { data, error } = await service
    .from("recibo_firmas")
    .insert({ recibo_id: reciboId, empleado_id: empleadoId, firma_id: firmaId, firmado_at: firmadoAt })
    .select("id")
    .single();
  if (error || !data) throw new Error(`evidence setup failed: ${error?.message}`);
  return data.id;
}

// Removes a receipt with no evidence or history, and then its period.
export async function borrarReciboYPeriodo(service: TypedClient, reciboId: string | null, periodoId: string) {
  if (reciboId) await service.from("recibos").delete().eq("id", reciboId);
  await service.from("recibo_periodos").delete().eq("id", periodoId);
}

// One set of append-only rows per titular, made once and reused by every
// cell (they cannot be removed): a published period with the titular's
// signed receipt, its evidence, one history row, one override and one
// period log entry.
export type ReciboPermanente = {
  periodo: string;
  recibo: string;
  firma: string;
  evidencia: string;
  historial: string;
  override: string;
  logPeriodo: string;
};

const permanentes = new Map<string, Promise<ReciboPermanente>>();

export function reciboPermanente(service: TypedClient, titular: string): Promise<ReciboPermanente> {
  let hecho = permanentes.get(titular);
  if (!hecho) {
    hecho = crearPermanente(service, titular);
    permanentes.set(titular, hecho);
  }
  return hecho;
}

async function crearPermanente(service: TypedClient, titular: string): Promise<ReciboPermanente> {
  const periodo = await nuevoPeriodo(service, titular, "publicado");
  const recibo = await nuevoRecibo(service, periodo.id, titular, titular);
  const firma = await nuevaFirma(service, titular);
  const evidencia = await firmarRecibo(service, recibo, titular, firma);
  const historial = await service
    .from("recibo_historial")
    .insert({
      recibo_id: recibo,
      periodo_id: periodo.id,
      empleado_id: titular,
      archivo_path: `${titular}/${periodo.id}/anterior.pdf`,
      archivo_bytes: 512,
      estado_al_reemplazo: "pendiente",
      cargado_por: titular,
      cargado_at: new Date().toISOString(),
      reemplazado_por: titular,
    })
    .select("id")
    .single();
  const override = await service
    .from("recibo_overrides")
    .insert({ recibo_id: recibo, motivo: "no_verificable", archivo_path: `${titular}/${periodo.id}/anterior.pdf`, admin_id: titular })
    .select("id")
    .single();
  const logPeriodo = await service
    .from("recibo_periodo_historial")
    .insert({ periodo_id: periodo.id, accion: "publicado", actor_id: titular })
    .select("id")
    .single();
  for (const paso of [historial, override, logPeriodo]) {
    if (paso.error || !paso.data) throw new Error(`append-only setup failed: ${paso.error?.message}`);
  }
  return {
    periodo: periodo.id,
    recibo,
    firma,
    evidencia,
    historial: historial.data!.id,
    override: override.data!.id,
    logPeriodo: logPeriodo.data!.id,
  };
}
