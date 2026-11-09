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
  const service = localServiceClient();
  const periodo = await periodoPublicado(adminId);
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
  return { id: data.id, periodo, etiqueta: `${String(periodo.mes).padStart(2, "0")}/${periodo.anio}` };
}

// A registered, active signature (version 1).
export async function firmaRegistrada(empleadoId: string) {
  const service = localServiceClient();
  const path = `${empleadoId}/1-${randomUUID()}.png`;
  const subida = await service.storage.from(FIRMAS_BUCKET).upload(path, pngFirma(), { contentType: "image/png" });
  if (subida.error) throw new Error(`signature upload failed: ${subida.error.message}`);
  const { error } = await service.from("firmas_empleado").insert({ empleado_id: empleadoId, version: 1, imagen_path: path, activa: true });
  if (error) throw new Error(`signature setup failed: ${error.message}`);
}
