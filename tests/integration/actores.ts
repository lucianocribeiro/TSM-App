import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { buildDocumentoPath } from "@/lib/documentos/paths";
import { DOCUMENTOS_BUCKET, type DocumentoTipo } from "@/lib/documentos/tipos";
import { getServerEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";
import { anonClient, createTestUser, TEST_PASSWORD, type TestUser, type TypedClient } from "./helpers";

// Account-state fixtures (F1-11A) for the local stack, shared by the RLS
// matrix, the account-state suite and the action boundary suite.
//
// A deactivated or forced-change actor is created through the real path (an
// active Admin calls desactivar_cuenta or marcar_password_temporal), which
// closes every session of the account. The access token captured before
// stays valid until it expires (jwt_expiry in supabase/config.toml): that is
// the window the database has to close. Each fixture checks the window is
// real: the refresh token no longer works and the token has not expired.

type AppRole = Database["public"]["Enums"]["app_role"];

export type ActorCapturado = TestUser & {
  // The access token captured before the state changed, still unexpired.
  token: string;
  // The refresh token of the same, now closed, session.
  refresh: string;
  // A client that sends exactly that access token, whatever happened to its
  // session. Use it for PostgREST, RPC and Storage assertions.
  porToken: TypedClient;
};

// A client bound to one access token. It has no Auth session of its own, so
// nothing (a failed refresh, a sign-out) can replace or drop the token.
export function clienteConToken(token: string): TypedClient {
  const { supabaseUrl, supabaseAnonKey } = getServerEnv();
  return createClient<Database>(supabaseUrl, supabaseAnonKey, { accessToken: async () => token });
}

export function segundosHastaExpirar(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
  return (payload.exp ?? 0) - Math.floor(Date.now() / 1000);
}

async function capturar(user: TestUser): Promise<{ token: string; refresh: string }> {
  const { data } = await user.client.auth.getSession();
  if (!data.session) throw new Error(`no session to capture for ${user.email}`);
  return { token: data.session.access_token, refresh: data.session.refresh_token };
}

// The session is closed (its refresh token is refused) while the access
// token is still far from expiring.
export async function sesionCerrada(refresh: string): Promise<boolean> {
  const { error } = await anonClient().auth.refreshSession({ refresh_token: refresh });
  return error !== null;
}

async function comprobarVentana(label: string, token: string, refresh: string) {
  if (!(await sesionCerrada(refresh))) throw new Error(`${label}: the session was not closed`);
  if (segundosHastaExpirar(token) < 300) throw new Error(`${label}: the captured token is about to expire`);
}

// Deactivated by an active Admin (desactivar_cuenta: state, event, sessions
// closed). user.client keeps the closed session in memory, as a browser keeps
// its cookie: use it for Server Actions.
export async function crearDesactivado(
  service: TypedClient,
  admin: TestUser,
  label: string,
  role: AppRole = "empleado",
): Promise<ActorCapturado> {
  const user = await createTestUser(service, label, role);
  const { token, refresh } = await capturar(user);
  const { error } = await admin.client.rpc("desactivar_cuenta", { p_profile_id: user.id, p_motivo: "Prueba F1-11A" });
  if (error) throw new Error(`deactivation failed for ${label}: ${error.message}`);
  await comprobarVentana(label, token, refresh);
  return { ...user, token, refresh, porToken: clienteConToken(token) };
}

// A temporary password set by an active Admin (marcar_password_temporal:
// flag, event, sessions closed), then signed in again with the change still
// pending, as after receiving a temporary password. user.client is that new
// live session; porToken is the token captured before the flag was set.
export async function crearCambioForzado(
  service: TypedClient,
  admin: TestUser,
  label: string,
  role: AppRole = "empleado",
): Promise<ActorCapturado> {
  const user = await createTestUser(service, label, role);
  const { token, refresh } = await capturar(user);
  const { error } = await admin.client.rpc("marcar_password_temporal", { p_profile_id: user.id });
  if (error) throw new Error(`forced change failed for ${label}: ${error.message}`);
  await comprobarVentana(label, token, refresh);
  const client = await nuevaSesion(user.email);
  return { ...user, client, token, refresh, porToken: clienteConToken(token) };
}

// A new, separate session for an existing user.
export async function nuevaSesion(email: string, password = TEST_PASSWORD): Promise<TypedClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

// ---------------------------------------------------------------------------
// Seeded data (service role) and whole-data snapshots
// ---------------------------------------------------------------------------
export function fakePdf(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% FAKE TEST FILE - ${label}\n%%EOF\n`);
}

export function rutaDocumento(profileId: string, tipo: DocumentoTipo): string {
  const path = buildDocumentoPath({ profileId, tipo, fileId: randomUUID(), mimeType: "application/pdf" });
  if (!path) throw new Error("invalid test path");
  return path;
}

export async function legajoIdDe(service: TypedClient, profileId: string): Promise<string> {
  const { data, error } = await service.from("legajos").select("id").eq("profile_id", profileId).single();
  if (error || !data) throw new Error(`no legajo for ${profileId}: ${error?.message}`);
  return data.id;
}

// One of each kind of own data, created with the service role (whatever the
// account's state): a pending change request with one item, a pending
// document and an approved one (each with its object), and a rowless object.
export type Semilla = {
  id: string;
  email: string;
  legajoId: string;
  solicitudId: string;
  docPendienteId: string;
  docPendientePath: string;
  docAprobadoId: string;
  docAprobadoPath: string;
  huerfanoPath: string;
};

export async function sembrar(service: TypedClient, user: TestUser, revisorId: string): Promise<Semilla> {
  const legajoId = await legajoIdDe(service, user.id);
  const storage = service.storage.from(DOCUMENTOS_BUCKET);

  const solicitud = await service
    .from("solicitudes_cambio")
    .insert({ legajo_id: legajoId, solicitado_por: user.id })
    .select("id")
    .single();
  if (solicitud.error || !solicitud.data) throw new Error(`seed request: ${solicitud.error?.message}`);
  const item = await service
    .from("solicitudes_cambio_items")
    .insert({ solicitud_id: solicitud.data.id, campo: "alergias", valor_propuesto: "Polen" });
  if (item.error) throw new Error(`seed item: ${item.error.message}`);

  async function documento(tipo: DocumentoTipo, estado: "pendiente" | "aprobado") {
    const path = rutaDocumento(user.id, tipo);
    const body = fakePdf(`${estado} ${user.email}`);
    const subida = await storage.upload(path, body, { contentType: "application/pdf" });
    if (subida.error) throw new Error(`seed object: ${subida.error.message}`);
    const revision =
      estado === "aprobado"
        ? { uploaded_by: revisorId, revisado_por: revisorId, revisado_en: new Date().toISOString() }
        : { uploaded_by: user.id };
    const { data, error } = await service
      .from("legajo_documentos")
      .insert({
        legajo_id: legajoId,
        tipo,
        storage_path: path,
        file_name: `${estado}.pdf`,
        mime_type: "application/pdf",
        size_bytes: body.length,
        estado,
        ...revision,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed document: ${error?.message}`);
    return { id: data.id, path };
  }

  const pendiente = await documento("dni_frente", "pendiente");
  const aprobado = await documento("dni_dorso", "aprobado");
  const huerfanoPath = rutaDocumento(user.id, "licencia_conducir");
  const huerfano = await storage.upload(huerfanoPath, fakePdf("huerfano"), { contentType: "application/pdf" });
  if (huerfano.error) throw new Error(`seed orphan: ${huerfano.error.message}`);

  return {
    id: user.id,
    email: user.email,
    legajoId,
    solicitudId: solicitud.data.id,
    docPendienteId: pendiente.id,
    docPendientePath: pendiente.path,
    docAprobadoId: aprobado.id,
    docAprobadoPath: aprobado.path,
    huerfanoPath,
  };
}

const TIPOS: DocumentoTipo[] = ["dni_frente", "dni_dorso", "licencia_conducir"];

async function filas<T>(consulta: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await consulta;
  if (error) throw new Error(`snapshot read failed: ${error.message}`);
  return data ?? [];
}

// Everything the given accounts own, read with the service role: every
// table, the objects in their folders (with size and update time, so an
// overwrite shows) and their Auth user (existence, email, ban). Two equal
// snapshots mean nothing of theirs changed in between.
export async function instantanea(service: TypedClient, ids: string[]) {
  const legajos = await filas(service.from("legajos").select("*").in("profile_id", ids).order("id"));
  const legajoIds = legajos.map((legajo) => legajo.id);
  const [profiles, hijos, documentos, solicitudes, eventos] = await Promise.all([
    filas(service.from("profiles").select("*").in("id", ids).order("id")),
    filas(service.from("legajo_hijos").select("*").in("legajo_id", legajoIds).order("id")),
    filas(service.from("legajo_documentos").select("*").in("legajo_id", legajoIds).order("id")),
    filas(service.from("solicitudes_cambio").select("*").in("legajo_id", legajoIds).order("id")),
    filas(service.from("cuenta_eventos").select("*").in("profile_id", ids).order("id")),
  ]);
  const items = await filas(
    service
      .from("solicitudes_cambio_items")
      .select("*")
      .in(
        "solicitud_id",
        solicitudes.map((solicitud) => solicitud.id),
      )
      .order("id"),
  );
  const objetos = await Promise.all(
    ids.flatMap((id) =>
      TIPOS.map(async (tipo) => {
        const { data, error } = await service.storage.from(DOCUMENTOS_BUCKET).list(`${id}/${tipo}`, { limit: 1000 });
        if (error) throw new Error(`snapshot list failed: ${error.message}`);
        return (data ?? [])
          .map((entry) => ({ path: `${id}/${tipo}/${entry.name}`, updated_at: entry.updated_at, size: entry.metadata?.size ?? null }))
          .sort((a, b) => a.path.localeCompare(b.path));
      }),
    ),
  );
  const usuarios = await Promise.all(
    ids.map(async (id) => {
      const { data } = await service.auth.admin.getUserById(id);
      return { id, existe: Boolean(data.user), email: data.user?.email ?? null, banned_until: data.user?.banned_until ?? null };
    }),
  );
  return { profiles, legajos, hijos, documentos, solicitudes, items, eventos, objetos, usuarios };
}
