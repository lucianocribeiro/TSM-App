import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { cuilDigitoVerificador } from "../src/lib/legajo/cuil";
import type { Database } from "../src/lib/supabase/database.types";
import { createE2EUser, deleteE2EUser, fillLegajo, localServiceClient } from "./service";

// Shared data setup for the F1-11B specs (local stack, service role). Every
// test creates its own accounts and data; nothing depends on other tests.

type DocumentoTipo = Database["public"]["Enums"]["documento_tipo"];
export const BUCKET = "legajo-docs";

// Accounts created by a spec file, removed in its afterAll.
export function registro() {
  const ids: string[] = [];
  return {
    add: (id: string) => ids.push(id),
    limpiar: async () => {
      for (const id of ids.reverse()) await deleteE2EUser(id);
    },
  };
}

// A valid CUIL for a DNI (prefix 20, or 23 when 20 has no check digit).
export function cuilPara(dni: string): string {
  for (const prefijo of ["20", "23"]) {
    const digito = cuilDigitoVerificador(`${prefijo}${dni}`);
    if (digito !== null) return `${prefijo}-${dni}-${digito}`;
  }
  throw new Error("no CUIL");
}

// A random 8-digit DNI (fictitious).
export function dniAleatorio(): string {
  return String(90_000_000 + Math.floor(Math.random() * 9_000_000));
}

// An Empleado with every group A to E filled with valid data. The apellido is
// unique, to find this employee's rows among other tests' data.
export async function empleadoCompleto(label: string, alta: (id: string) => void, extra: { tieneHijos?: boolean } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const user = await createE2EUser(`${label}-${suffix}`);
  alta(user.id);
  const dni = dniAleatorio();
  const apellido = `Prueba${suffix}`;
  await fillLegajo(user.id, {
    nombres: "Ana",
    apellido,
    dni,
    nacionalidad: "Argentina",
    cuil: cuilPara(dni),
    fecha_nacimiento: "1990-01-01",
    calle_altura: "Calle Falsa 123",
    piso_depto: null,
    localidad: "Localidad de Prueba",
    partido: "Tigre",
    partido_otro: null,
    telefono_celular: "11 4444-5555",
    email_personal: "e2e.personal@example.test",
    estado_civil: "soltero",
    nombre_conyuge: null,
    tiene_hijos: extra.tieneHijos ?? false,
    grupo_sanguineo: "0+",
    alergias: "Ninguna",
    medicacion_habitual: "Ninguna",
    obra_social: "Obra Social de Prueba",
    numero_afiliado: "123",
    emergencia_nombre: "Contacto",
    emergencia_parentesco: "Madre",
    emergencia_domicilio: "Calle 2",
    emergencia_telefono: "11 5555-6666",
    numero_legajo: `F-${suffix}`,
    area: "Área de Prueba",
    puesto: "Técnico",
    fecha_ingreso: "2020-01-15",
    estado_laboral: "activo",
    sede: "Sede Norte",
    modalidad: "Presencial",
    convenio: "Convenio de Prueba",
    bruto_mensual: 850000,
  });
  const legajoId = await legajoIdDe(user.id);
  return { ...user, apellido, nombre: `Ana ${apellido}`, legajoId, dni };
}

export async function adminNuevo(label: string, alta: (id: string) => void) {
  const user = await createE2EUser(`${label}-${randomUUID().slice(0, 8)}`, "admin");
  alta(user.id);
  return user;
}

export async function legajoIdDe(profileId: string): Promise<string> {
  const { data, error } = await localServiceClient().from("legajos").select("id").eq("profile_id", profileId).single();
  if (error || !data) throw new Error(`legajo lookup failed: ${error?.message}`);
  return data.id;
}

export async function legajoDe(profileId: string) {
  const { data, error } = await localServiceClient().from("legajos").select("*").eq("profile_id", profileId).single();
  if (error || !data) throw new Error(`legajo read failed: ${error?.message}`);
  return data;
}

export async function hijosDe(legajoId: string) {
  const { data } = await localServiceClient()
    .from("legajo_hijos")
    .select("nombre_completo, fecha_nacimiento")
    .eq("legajo_id", legajoId)
    .order("fecha_nacimiento");
  return data ?? [];
}

// A pending change request by the employee, as crear_solicitud would store
// it, optionally with a given submission time.
export async function solicitudPendiente(
  empleado: { id: string; legajoId: string },
  items: { campo: string; valor_propuesto: string | null }[],
  creadoEn?: string,
) {
  const service = localServiceClient();
  const { data, error } = await service
    .from("solicitudes_cambio")
    .insert({ legajo_id: empleado.legajoId, solicitado_por: empleado.id, ...(creadoEn ? { created_at: creadoEn } : {}) })
    .select("id, created_at")
    .single();
  expect(error).toBeNull();
  const itemsError = (await service.from("solicitudes_cambio_items").insert(items.map((item) => ({ ...item, solicitud_id: data!.id })))).error;
  expect(itemsError).toBeNull();
  return data!;
}

export function pdf(label: string) {
  return { name: `${label}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% FAKE TEST FILE - ${label}\n%%EOF\n`) };
}

// A pending document uploaded by the employee (object and row), optionally
// with a given submission time.
export async function documentoPendiente(empleado: { id: string; legajoId: string }, tipo: DocumentoTipo, label: string, creadoEn?: string) {
  const service = localServiceClient();
  const path = `${empleado.id}/${tipo}/${randomUUID()}.pdf`;
  const file = pdf(label);
  expect((await service.storage.from(BUCKET).upload(path, file.buffer, { contentType: "application/pdf" })).error).toBeNull();
  const { data, error } = await service
    .from("legajo_documentos")
    .insert({
      legajo_id: empleado.legajoId,
      tipo,
      storage_path: path,
      file_name: file.name,
      mime_type: "application/pdf",
      size_bytes: file.buffer.length,
      uploaded_by: empleado.id,
      ...(creadoEn ? { created_at: creadoEn } : {}),
    })
    .select("id, created_at")
    .single();
  expect(error).toBeNull();
  return { ...data!, path };
}

// An ISO timestamp some hours before now.
export function haceHoras(horas: number): string {
  return new Date(Date.now() - horas * 3_600_000).toISOString();
}

// A signed-in session of a throwaway user (local stack only), to act as that
// user through the API (the database sees auth.uid()).
export async function sesionDe(user: { email: string; password: string }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
    throw new Error("e2e sessions run against the local Supabase stack only.");
  }
  const client = createClient<Database>(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return client;
}
