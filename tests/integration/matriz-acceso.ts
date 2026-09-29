import { randomUUID } from "node:crypto";
import { DOCUMENTOS_BUCKET } from "@/lib/documentos/tipos";
import type { Database } from "@/lib/supabase/database.types";
import { fakePdf, rutaDocumento } from "./actores";
import type { TypedClient } from "./helpers";

// The access matrix (F1-11A, GAP-01 and GAP-02): every table and the
// legajo-docs bucket, every actor, every operation (SELECT, INSERT, UPDATE,
// DELETE), with the exact expected outcome. Table-driven: a new table is one
// entry in TABLAS (the type requires an entry for every table in the
// generated types) with its expectation for every actor in ACTORES.
//
// Each cell runs on fresh target data owned by the cell's titular (set up
// with the service role and removed afterwards). A cell that is not allowed
// must also leave the titular's data exactly as it was.

export const OPS = ["select", "insert", "update", "delete"] as const;
export type Op = (typeof OPS)[number];

// Role actors (matriz-acceso.test.ts) and account-state actors
// (estado-cuenta-rls.test.ts). "-propio": on their own data; "-ajeno" and
// the Admin and anon: on another employee's data.
export const ACTORES_ROL = ["anon", "empleado-propio", "empleado-ajeno", "admin"] as const;
export const ACTORES_ESTADO = [
  "desactivado-propio",
  "admin-desactivado-ajeno",
  "admin-desactivado-propio",
  "cambio-forzado-propio",
] as const;
export type Actor = (typeof ACTORES_ROL)[number] | (typeof ACTORES_ESTADO)[number];

// permitido: the operation reached the target (rows returned or written).
// sin-filas: no error, but RLS let no row through; nothing was written.
// denegado: a permission error (42501: no privilege, or an RLS check failed);
//   for Storage writes, any refusal.
// error:<code>: another database error (the policy let it through).
export type Resultado = "permitido" | "sin-filas" | "denegado" | `error:${string}`;

export type Titular = { id: string; legajoId: string };
export type Llamante = { cliente: TypedClient; id: string | null };
type Objetivo = Record<string, string>;
type Operacion = (cliente: TypedClient, llamante: Llamante, titular: Titular, objetivo: Objetivo) => Promise<Resultado>;

export type EspecTabla = {
  preparar(service: TypedClient, titular: Titular): Promise<Objetivo>;
  estado(service: TypedClient, titular: Titular, objetivo: Objetivo): Promise<unknown>;
  ops: Record<Op, Operacion>;
  limpiar(service: TypedClient, titular: Titular, objetivo: Objetivo): Promise<void>;
  esperado: Record<Actor, Record<Op, Resultado>>;
};

type Respuesta = { data: unknown[] | null; error: { code?: string } | null };

export function clasificar({ data, error }: Respuesta): Resultado {
  if (error) return error.code === "42501" ? "denegado" : `error:${error.code ?? "desconocido"}`;
  return (data?.length ?? 0) > 0 ? "permitido" : "sin-filas";
}

const r = async (consulta: PromiseLike<Respuesta>) => clasificar(await consulta);

async function filas<T>(consulta: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await consulta;
  if (error) throw new Error(`service read failed: ${error.message}`);
  return data ?? [];
}

async function primera<T>(consulta: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T> {
  const [fila] = await filas(consulta);
  if (!fila) throw new Error("service write returned no row");
  return fila;
}

const P = "permitido";
const V = "sin-filas";
const N = "denegado";
const e = (select: Resultado, insert: Resultado, update: Resultado, del: Resultado): Record<Op, Resultado> => ({
  select,
  insert,
  update,
  delete: del,
});

// The same expectation for every account-state actor that cannot reach
// anything (inactive account), and for the forced-change actor, who by design
// is an active user at the database (the app refuses them).
const inactivo = (fila: Record<Op, Resultado>) => ({
  "desactivado-propio": fila,
  "admin-desactivado-ajeno": fila,
  "admin-desactivado-propio": fila,
});

type Tabla = keyof Database["public"]["Tables"];
export const BUCKET_DOCUMENTOS = `storage.objects (${DOCUMENTOS_BUCKET})`;

// A pending change request with one item, for solicitudes_cambio and its items.
async function solicitudPendiente(service: TypedClient, titular: Titular): Promise<Objetivo> {
  const solicitud = await primera(
    service.from("solicitudes_cambio").insert({ legajo_id: titular.legajoId, solicitado_por: titular.id }).select("id"),
  );
  const item = await primera(
    service
      .from("solicitudes_cambio_items")
      .insert({ solicitud_id: solicitud.id, campo: "alergias", valor_propuesto: "Polen" })
      .select("id"),
  );
  return { id: solicitud.id, item: item.id };
}

async function solicitudesDe(service: TypedClient, titular: Titular) {
  const solicitudes = await filas(service.from("solicitudes_cambio").select("*").eq("legajo_id", titular.legajoId).order("id"));
  const items = await filas(
    service
      .from("solicitudes_cambio_items")
      .select("*")
      .in(
        "solicitud_id",
        solicitudes.map((s) => s.id),
      )
      .order("id"),
  );
  return { solicitudes, items };
}

async function borrarSolicitudes(service: TypedClient, titular: Titular) {
  await service.from("solicitudes_cambio").delete().eq("legajo_id", titular.legajoId);
}

export const TABLAS: Record<Tabla | typeof BUCKET_DOCUMENTOS, EspecTabla> = {
  // No INSERT or DELETE for any API role; UPDATE (role) is Admin only.
  // An inactive user keeps SELECT of their own row, and only that.
  profiles: {
    preparar: async (service, titular) => {
      const perfil = await primera(service.from("profiles").select("role").eq("id", titular.id));
      return { role: perfil.role };
    },
    estado: (service, titular) => filas(service.from("profiles").select("*").eq("id", titular.id)),
    ops: {
      select: (c, _l, t) => r(c.from("profiles").select("id").eq("id", t.id)),
      insert: (c) => r(c.from("profiles").insert({ id: randomUUID() }).select("id")),
      // The same role again: allowed or not, the value does not change.
      update: (c, _l, t, o) =>
        r(c.from("profiles").update({ role: o.role as Database["public"]["Enums"]["app_role"] }).eq("id", t.id).select("id")),
      delete: (c, _l, t) => r(c.from("profiles").delete().eq("id", t.id).select("id")),
    },
    limpiar: async () => undefined,
    esperado: {
      anon: e(N, N, N, N),
      "empleado-propio": e(P, N, V, N),
      "empleado-ajeno": e(V, N, V, N),
      admin: e(P, N, P, N),
      "desactivado-propio": e(P, N, V, N),
      "admin-desactivado-ajeno": e(V, N, V, N),
      "admin-desactivado-propio": e(P, N, V, N),
      "cambio-forzado-propio": e(P, N, V, N),
    },
  },

  // Every profile already has its legajo: an Admin INSERT passes the policy
  // and stops at the unique profile_id (23505). No DELETE grant.
  legajos: {
    preparar: async () => ({}),
    estado: (service, titular) => filas(service.from("legajos").select("*").eq("id", titular.legajoId)),
    ops: {
      select: (c, _l, t) => r(c.from("legajos").select("id").eq("id", t.legajoId)),
      insert: (c, _l, t) => r(c.from("legajos").insert({ profile_id: t.id }).select("id")),
      update: (c, _l, t) => r(c.from("legajos").update({ alergias: `Matriz ${randomUUID()}` }).eq("id", t.legajoId).select("id")),
      delete: (c, _l, t) => r(c.from("legajos").delete().eq("id", t.legajoId).select("id")),
    },
    limpiar: async () => undefined,
    esperado: {
      anon: e(N, N, N, N),
      "empleado-propio": e(P, N, V, N),
      "empleado-ajeno": e(V, N, V, N),
      admin: e(P, "error:23505", P, N),
      ...inactivo(e(V, N, V, N)),
      "cambio-forzado-propio": e(P, N, V, N),
    },
  },

  // Writes are Admin only (an Empleado's changes go through requests).
  legajo_hijos: {
    preparar: async (service, titular) => {
      const hijo = await primera(
        service
          .from("legajo_hijos")
          .insert({ legajo_id: titular.legajoId, nombre_completo: "Hijo Matriz", fecha_nacimiento: "2015-05-05" })
          .select("id"),
      );
      return { id: hijo.id };
    },
    estado: (service, titular) => filas(service.from("legajo_hijos").select("*").eq("legajo_id", titular.legajoId).order("id")),
    ops: {
      select: (c, _l, _t, o) => r(c.from("legajo_hijos").select("id").eq("id", o.id)),
      insert: (c, _l, t) =>
        r(
          c
            .from("legajo_hijos")
            .insert({ legajo_id: t.legajoId, nombre_completo: "Hijo Intento", fecha_nacimiento: "2016-06-06" })
            .select("id"),
        ),
      update: (c, _l, _t, o) => r(c.from("legajo_hijos").update({ nombre_completo: "Hijo Cambiado" }).eq("id", o.id).select("id")),
      delete: (c, _l, _t, o) => r(c.from("legajo_hijos").delete().eq("id", o.id).select("id")),
    },
    limpiar: async (service, titular) => {
      await service.from("legajo_hijos").delete().eq("legajo_id", titular.legajoId);
    },
    esperado: {
      anon: e(N, N, N, N),
      "empleado-propio": e(P, N, V, V),
      "empleado-ajeno": e(V, N, V, V),
      admin: e(P, P, P, P),
      ...inactivo(e(V, N, V, V)),
      "cambio-forzado-propio": e(P, N, V, V),
    },
  },

  // The target is a pending document. The caller inserts as the uploader;
  // an Admin's UPDATE names themselves as the uploader (the policy asks it).
  legajo_documentos: {
    preparar: async (service, titular) => {
      const documento = await primera(
        service
          .from("legajo_documentos")
          .insert({
            legajo_id: titular.legajoId,
            tipo: "dni_frente",
            storage_path: rutaDocumento(titular.id, "dni_frente"),
            file_name: "matriz.pdf",
            mime_type: "application/pdf",
            size_bytes: 10,
            uploaded_by: titular.id,
          })
          .select("id"),
      );
      return { id: documento.id };
    },
    estado: (service, titular) =>
      filas(service.from("legajo_documentos").select("*").eq("legajo_id", titular.legajoId).order("id")),
    ops: {
      select: (c, _l, _t, o) => r(c.from("legajo_documentos").select("id").eq("id", o.id)),
      insert: (c, l, t) =>
        r(
          c
            .from("legajo_documentos")
            .insert({
              legajo_id: t.legajoId,
              tipo: "dni_dorso",
              storage_path: rutaDocumento(t.id, "dni_dorso"),
              file_name: "intento.pdf",
              mime_type: "application/pdf",
              size_bytes: 10,
              uploaded_by: l.id ?? t.id,
            })
            .select("id"),
        ),
      update: (c, l, t, o) =>
        r(c.from("legajo_documentos").update({ file_name: "cambiado.pdf", uploaded_by: l.id ?? t.id }).eq("id", o.id).select("id")),
      delete: (c, _l, _t, o) => r(c.from("legajo_documentos").delete().eq("id", o.id).select("id")),
    },
    limpiar: async (service, titular) => {
      await service.from("legajo_documentos").delete().eq("legajo_id", titular.legajoId);
    },
    esperado: {
      anon: e(N, N, N, N),
      "empleado-propio": e(P, P, V, P),
      "empleado-ajeno": e(V, N, V, V),
      admin: e(P, P, P, P),
      ...inactivo(e(V, N, V, V)),
      "cambio-forzado-propio": e(P, P, V, P),
    },
  },

  // No INSERT (crear_solicitud only) or DELETE grant. UPDATE is the
  // requester's own cancellation, and nothing else.
  solicitudes_cambio: {
    preparar: solicitudPendiente,
    estado: solicitudesDe,
    ops: {
      select: (c, _l, _t, o) => r(c.from("solicitudes_cambio").select("id").eq("id", o.id)),
      insert: (c, _l, t) => r(c.from("solicitudes_cambio").insert({ legajo_id: t.legajoId }).select("id")),
      update: (c, _l, _t, o) => r(c.from("solicitudes_cambio").update({ estado: "cancelada" }).eq("id", o.id).select("id")),
      delete: (c, _l, _t, o) => r(c.from("solicitudes_cambio").delete().eq("id", o.id).select("id")),
    },
    limpiar: borrarSolicitudes,
    esperado: {
      anon: e(N, N, N, N),
      "empleado-propio": e(P, N, P, N),
      "empleado-ajeno": e(V, N, V, N),
      admin: e(P, N, V, N),
      ...inactivo(e(V, N, V, N)),
      "cambio-forzado-propio": e(P, N, P, N),
    },
  },

  // Read only for every API role.
  solicitudes_cambio_items: {
    preparar: solicitudPendiente,
    estado: solicitudesDe,
    ops: {
      select: (c, _l, _t, o) => r(c.from("solicitudes_cambio_items").select("id").eq("id", o.item)),
      insert: (c, _l, _t, o) =>
        r(c.from("solicitudes_cambio_items").insert({ solicitud_id: o.id, campo: "nombres", valor_propuesto: "Intento" }).select("id")),
      update: (c, _l, _t, o) =>
        r(c.from("solicitudes_cambio_items").update({ valor_propuesto: "Cambiado" }).eq("id", o.item).select("id")),
      delete: (c, _l, _t, o) => r(c.from("solicitudes_cambio_items").delete().eq("id", o.item).select("id")),
    },
    limpiar: borrarSolicitudes,
    esperado: {
      anon: e(N, N, N, N),
      "empleado-propio": e(P, N, N, N),
      "empleado-ajeno": e(V, N, N, N),
      admin: e(P, N, N, N),
      ...inactivo(e(V, N, N, N)),
      "cambio-forzado-propio": e(P, N, N, N),
    },
  },

  // Read only for every API role; written by the account functions.
  cuenta_eventos: {
    preparar: async (service, titular) => {
      const evento = await primera(
        service.from("cuenta_eventos").insert({ profile_id: titular.id, tipo: "reactivacion", actor_id: titular.id }).select("id"),
      );
      return { id: evento.id };
    },
    estado: (service, titular) => filas(service.from("cuenta_eventos").select("*").eq("profile_id", titular.id).order("id")),
    ops: {
      select: (c, _l, _t, o) => r(c.from("cuenta_eventos").select("id").eq("id", o.id)),
      insert: (c, l, t) =>
        r(c.from("cuenta_eventos").insert({ profile_id: t.id, tipo: "creacion", actor_id: l.id ?? t.id }).select("id")),
      update: (c, _l, _t, o) => r(c.from("cuenta_eventos").update({ motivo: null }).eq("id", o.id).select("id")),
      delete: (c, _l, _t, o) => r(c.from("cuenta_eventos").delete().eq("id", o.id).select("id")),
    },
    limpiar: async (service, _titular, objetivo) => {
      await service.from("cuenta_eventos").delete().eq("id", objetivo.id);
    },
    esperado: {
      anon: e(N, N, N, N),
      "empleado-propio": e(P, N, N, N),
      "empleado-ajeno": e(V, N, N, N),
      admin: e(P, N, N, N),
      ...inactivo(e(V, N, N, N)),
      "cambio-forzado-propio": e(P, N, N, N),
    },
  },

  // The target is an object with a pending document row (an Empleado may
  // overwrite or delete it). SELECT is a download; INSERT an upload to a new
  // path in the titular's folder; UPDATE an overwrite; DELETE a removal.
  [BUCKET_DOCUMENTOS]: {
    preparar: async (service, titular) => {
      const path = rutaDocumento(titular.id, "dni_frente");
      const subida = await service.storage.from(DOCUMENTOS_BUCKET).upload(path, fakePdf("matriz original"), {
        contentType: "application/pdf",
      });
      if (subida.error) throw new Error(`service upload failed: ${subida.error.message}`);
      const documento = await primera(
        service
          .from("legajo_documentos")
          .insert({
            legajo_id: titular.legajoId,
            tipo: "dni_frente",
            storage_path: path,
            file_name: "matriz.pdf",
            mime_type: "application/pdf",
            size_bytes: 10,
            uploaded_by: titular.id,
          })
          .select("id"),
      );
      return { path, nuevo: rutaDocumento(titular.id, "dni_dorso"), documento: documento.id };
    },
    estado: async (service, _titular, o) => {
      const bucket = service.storage.from(DOCUMENTOS_BUCKET);
      const [actual, nuevo] = await Promise.all([bucket.download(o.path), bucket.download(o.nuevo)]);
      return {
        actual: actual.data ? await actual.data.text() : null,
        nuevo: nuevo.data ? await nuevo.data.text() : null,
      };
    },
    ops: {
      select: async (c, _l, _t, o) => ((await c.storage.from(DOCUMENTOS_BUCKET).download(o.path)).data ? P : V),
      insert: async (c, _l, _t, o) => {
        const { error } = await c.storage
          .from(DOCUMENTOS_BUCKET)
          .upload(o.nuevo, fakePdf("matriz intento"), { contentType: "application/pdf" });
        return error ? N : P;
      },
      update: async (c, _l, _t, o) => {
        const { error } = await c.storage
          .from(DOCUMENTOS_BUCKET)
          .update(o.path, fakePdf("matriz cambiado"), { contentType: "application/pdf" });
        return error ? N : P;
      },
      delete: async (c, _l, _t, o) => {
        const { data, error } = await c.storage.from(DOCUMENTOS_BUCKET).remove([o.path]);
        if (error) return N;
        return (data?.length ?? 0) > 0 ? P : V;
      },
    },
    limpiar: async (service, _titular, o) => {
      await service.storage.from(DOCUMENTOS_BUCKET).remove([o.path, o.nuevo]);
      await service.from("legajo_documentos").delete().eq("id", o.documento);
    },
    esperado: {
      anon: e(V, N, N, V),
      "empleado-propio": e(P, P, P, P),
      "empleado-ajeno": e(V, N, N, V),
      admin: e(P, P, P, P),
      ...inactivo(e(V, N, N, V)),
      "cambio-forzado-propio": e(P, P, P, P),
    },
  },
};

// Runs one cell on fresh target data and returns the outcome with the
// titular's data before and after.
export async function ejecutarCelda(
  service: TypedClient,
  espec: EspecTabla,
  op: Op,
  llamante: Llamante,
  titular: Titular,
): Promise<{ resultado: Resultado; antes: unknown; despues: unknown }> {
  const objetivo = await espec.preparar(service, titular);
  try {
    const antes = await espec.estado(service, titular, objetivo);
    const resultado = await espec.ops[op](llamante.cliente, llamante, titular, objetivo);
    const despues = await espec.estado(service, titular, objetivo);
    return { resultado, antes, despues };
  } finally {
    await espec.limpiar(service, titular, objetivo);
  }
}
