import { randomInt, randomUUID } from "node:crypto";
import { pdfConTexto } from "../tests/pdf-minimo";
import { pngFirma } from "../tests/png-minimo";
import { localServiceClient } from "./service";

// F2-05 e2e fixtures, written with the service role: a published receipt
// with a real PDF, and a registered signature. Invented content only.

export const RECIBOS_BUCKET = "recibos";
export const FIRMAS_BUCKET = "firmas";

// A published period in a month no other test uses.
export async function periodoPublicado(adminId: string): Promise<{ id: string; anio: number; mes: number }> {
  const service = localServiceClient();
  for (let intento = 0; intento < 50; intento++) {
    const { data } = await service
      .from("recibo_periodos")
      .insert({
        anio: randomInt(2030, 2100),
        mes: randomInt(1, 13),
        estado: "publicado",
        created_by: adminId,
        publicado_at: new Date().toISOString(),
        publicado_por: adminId,
      })
      .select("id, anio, mes")
      .single();
    if (data) return data;
  }
  throw new Error("no free month");
}

export async function reciboPublicado(empleadoId: string, adminId: string) {
  return reciboEnPeriodo(await periodoPublicado(adminId), empleadoId, adminId);
}

// A pending receipt with a real PDF in a given period.
export async function reciboEnPeriodo(periodo: { id: string; anio: number; mes: number }, empleadoId: string, adminId: string) {
  const service = localServiceClient();
  const path = `${empleadoId}/${periodo.id}/${randomUUID()}.pdf`;
  const subida = await service.storage
    .from(RECIBOS_BUCKET)
    .upload(path, pdfConTexto(["RECIBO DE HABERES - EMPRESA DE PRUEBA", "Recibo de prueba"]), { contentType: "application/pdf" });
  if (subida.error) throw new Error(`receipt upload failed: ${subida.error.message}`);
  const { data, error } = await service
    .from("recibos")
    .insert({ periodo_id: periodo.id, empleado_id: empleadoId, archivo_path: path, archivo_bytes: 900, cargado_por: adminId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`receipt setup failed: ${error?.message}`);
  return { id: data.id, path, periodo, etiqueta: `${String(periodo.mes).padStart(2, "0")}/${periodo.anio}` };
}

// A registered, active signature (version 1). Returns its id.
export async function firmaRegistrada(empleadoId: string): Promise<string> {
  const service = localServiceClient();
  const path = `${empleadoId}/1-${randomUUID()}.png`;
  const subida = await service.storage.from(FIRMAS_BUCKET).upload(path, pngFirma(), { contentType: "image/png" });
  if (subida.error) throw new Error(`signature upload failed: ${subida.error.message}`);
  const { data, error } = await service
    .from("firmas_empleado")
    .insert({ empleado_id: empleadoId, version: 1, imagen_path: path, activa: true })
    .select("id")
    .single();
  if (error || !data) throw new Error(`signature setup failed: ${error?.message}`);
  return data.id;
}

// F2-06: a receipt marked signed with a registered signature, and its
// evidence row, as recibo_firmar leaves them (the stored file stays the
// seeded one: the stamp is not what these tests look at).
export async function firmadoConServicio(reciboId: string, empleadoId: string): Promise<void> {
  const service = localServiceClient();
  const firmaId = await firmaRegistrada(empleadoId);
  const firmadoAt = new Date().toISOString();
  const firmado = await service.from("recibos").update({ estado: "firmado", firmado_at: firmadoAt, firma_id: firmaId }).eq("id", reciboId);
  if (firmado.error) throw new Error(`receipt sign failed: ${firmado.error.message}`);
  const evidencia = await service.from("recibo_firmas").insert({ recibo_id: reciboId, empleado_id: empleadoId, firma_id: firmaId, firmado_at: firmadoAt });
  if (evidencia.error) throw new Error(`evidence setup failed: ${evidencia.error.message}`);
}

// F2-06: one replaced (pending) file in the receipt's history, stored.
export async function archivoReemplazado(recibo: { id: string; periodoId: string }, empleadoId: string, adminId: string): Promise<string> {
  const service = localServiceClient();
  const path = `${empleadoId}/${recibo.periodoId}/${randomUUID()}.pdf`;
  const subida = await service.storage
    .from(RECIBOS_BUCKET)
    .upload(path, pdfConTexto(["RECIBO DE HABERES - EMPRESA DE PRUEBA", "Recibo reemplazado"]), { contentType: "application/pdf" });
  if (subida.error) throw new Error(`replaced file upload failed: ${subida.error.message}`);
  const { data, error } = await service
    .from("recibo_historial")
    .insert({
      recibo_id: recibo.id,
      periodo_id: recibo.periodoId,
      empleado_id: empleadoId,
      archivo_path: path,
      archivo_bytes: 900,
      estado_al_reemplazo: "pendiente",
      cargado_por: adminId,
      cargado_at: new Date(Date.now() - 3_600_000).toISOString(),
      reemplazado_por: adminId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`history setup failed: ${error?.message}`);
  return path;
}

// F2-06, decision 7: the "Recibos sin firmar" number, straight from the
// database (distinct employees with a pending receipt in a visible period).
export async function contarSinFirmar(): Promise<number> {
  const { data, error } = await localServiceClient()
    .from("recibos")
    .select("empleado_id, recibo_periodos!inner(estado)")
    .eq("estado", "pendiente")
    .in("recibo_periodos.estado", ["publicado", "cerrado"]);
  if (error) throw new Error(`count failed: ${error.message}`);
  return new Set((data ?? []).map((fila) => fila.empleado_id)).size;
}
