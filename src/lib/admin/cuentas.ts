import "server-only";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { passwordSchema } from "@/lib/auth/password";
import { copy } from "@/lib/copy/es-AR";
import { DOCUMENTOS_BUCKET } from "@/lib/documentos/tipos";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Account lifecycle for Admins (Constitution §10, PRD US-5, US-8, US-9).
//
// The only module allowed to use the service-role client (enforced by ESLint).
// It needs it for the Supabase Auth Admin API: creating users, setting
// passwords, banning, deleting, and removing a purged account's files.
//
// Safety:
// - Every function first verifies, with the caller's own session client, that
//   the caller is an active Admin (public.is_admin()). Nothing touches the
//   service-role client before that check passes.
// - State changes and history go through the database functions, called with
//   the caller's session, so the database records the real actor and applies
//   its own Admin guard as well.
// - Results carry ids and counts only. Passwords are never returned or logged,
//   and errors are es-AR messages from the copy module.

type AppRole = Database["public"]["Enums"]["app_role"];
type SessionClient = Awaited<ReturnType<typeof createClient>>;
type ServiceClient = ReturnType<typeof createAdminClient>;
type DbError = { code?: string; hint?: string | null } | null | undefined;

const errors = copy.cuentas.errors;

// Auth bans are durations: 100 years stands for "until reactivated".
const BAN_UNTIL_REACTIVATED = "876000h";
const LIFT_BAN = "none";

const uuidSchema = z.uuid();
const emailSchema = z.string().trim().pipe(z.email());
const rolSchema = z.enum(["empleado", "admin"]);
const motivoSchema = z.string().regex(/\S/);

const failed = (error: string): { ok: false; error: string } => ({ ok: false, error });

type Admin = { id: string; session: SessionClient };

async function requireAdmin(): Promise<Admin | null> {
  try {
    const session = await createClient();
    const {
      data: { user },
      error,
    } = await session.auth.getUser();
    if (error || !user) return null;
    const { data: isAdmin, error: roleError } = await session.rpc("is_admin");
    if (roleError || isAdmin !== true) return null;
    return { id: user.id, session };
  } catch {
    return null;
  }
}

// es-AR message for an error raised by the account functions.
export function cuentaErrorMessage(error: DbError): string {
  switch (error?.hint) {
    case "cuenta_propia":
      return errors.cuentaPropia;
    case "ultimo_admin":
      return errors.ultimoAdmin;
    case "ya_inactiva":
      return errors.yaInactiva;
    case "ya_activa":
      return errors.yaActiva;
  }
  switch (error?.code) {
    case "42501":
      return errors.noAutorizado;
    case "22023":
      return errors.motivoRequerido;
    case "P0002":
      return errors.cuentaNoEncontrada;
    default:
      return errors.accionFallo;
  }
}

// Auth Admin API errors that have their own message.
function authErrorMessage(error: { code?: string } | null): string {
  switch (error?.code) {
    case "email_exists":
      return errors.emailExistente;
    case "user_not_found":
      return errors.cuentaNoEncontrada;
    case "weak_password":
      return copy.password.errors.demasiadoCorta;
    default:
      return errors.accionFallo;
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export async function crearUsuario(input: {
  email: string;
  passwordTemporal: string;
  rol: AppRole;
}): Promise<ActionResult<{ profileId: string }>> {
  const admin = await requireAdmin();
  if (!admin) return failed(errors.noAutorizado);

  const email = emailSchema.safeParse(input.email);
  if (!email.success) return failed(errors.emailInvalido);
  const password = passwordSchema.safeParse(input.passwordTemporal);
  if (!password.success) return failed(password.error.issues[0]?.message ?? errors.accionFallo);
  const rol = rolSchema.safeParse(input.rol);
  if (!rol.success) return failed(errors.rolInvalido);

  const service = createAdminClient();
  const created = await service.auth.admin.createUser({
    email: email.data,
    password: password.data,
    email_confirm: true,
  });
  if (created.error || !created.data.user) return failed(authErrorMessage(created.error));
  const profileId = created.data.user.id;

  // The profile is created as empleado by the auth trigger.
  if (rol.data === "admin") {
    const promoted = await service.from("profiles").update({ role: "admin" }).eq("id", profileId);
    if (promoted.error) return rollbackCreation(service, profileId);
  }

  const registered = await admin.session.rpc("registrar_creacion_cuenta", { p_profile_id: profileId });
  if (registered.error) return rollbackCreation(service, profileId);

  return { ok: true, data: { profileId } };
}

// A half-created account is removed so the Admin can simply try again.
async function rollbackCreation(service: ServiceClient, profileId: string) {
  await service.auth.admin.deleteUser(profileId);
  return failed(errors.accionFallo);
}

// ---------------------------------------------------------------------------
// Temporary password
// ---------------------------------------------------------------------------
// Setting a password through the Admin API ends every session of the user;
// marcar_password_temporal flags the forced change and ends them as well.
export async function resetPasswordTemporal(input: {
  profileId: string;
  passwordTemporal: string;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return failed(errors.noAutorizado);

  if (!uuidSchema.safeParse(input.profileId).success) return failed(errors.cuentaNoEncontrada);
  const password = passwordSchema.safeParse(input.passwordTemporal);
  if (!password.success) return failed(password.error.issues[0]?.message ?? errors.accionFallo);

  const service = createAdminClient();
  const updated = await service.auth.admin.updateUserById(input.profileId, { password: password.data });
  if (updated.error) return failed(authErrorMessage(updated.error));

  const marked = await admin.session.rpc("marcar_password_temporal", { p_profile_id: input.profileId });
  if (marked.error) return failed(cuentaErrorMessage(marked.error));

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Deactivate and reactivate
// ---------------------------------------------------------------------------
// desactivar_cuenta records the state and the event and ends the sessions;
// the ban then makes signing in impossible.
export async function desactivarCuenta(input: {
  profileId: string;
  motivo: string;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return failed(errors.noAutorizado);

  if (!uuidSchema.safeParse(input.profileId).success) return failed(errors.cuentaNoEncontrada);
  if (input.profileId === admin.id) return failed(errors.cuentaPropia);
  if (!motivoSchema.safeParse(input.motivo).success) return failed(errors.motivoRequerido);

  const deactivated = await admin.session.rpc("desactivar_cuenta", {
    p_profile_id: input.profileId,
    p_motivo: input.motivo,
  });
  if (deactivated.error) return failed(cuentaErrorMessage(deactivated.error));

  const service = createAdminClient();
  const banned = await service.auth.admin.updateUserById(input.profileId, {
    ban_duration: BAN_UNTIL_REACTIVATED,
  });
  if (banned.error) return failed(errors.accionFallo);

  return { ok: true };
}

export async function reactivarCuenta(input: { profileId: string }): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return failed(errors.noAutorizado);

  if (!uuidSchema.safeParse(input.profileId).success) return failed(errors.cuentaNoEncontrada);

  const reactivated = await admin.session.rpc("reactivar_cuenta", { p_profile_id: input.profileId });
  if (reactivated.error) return failed(cuentaErrorMessage(reactivated.error));

  const service = createAdminClient();
  const unbanned = await service.auth.admin.updateUserById(input.profileId, { ban_duration: LIFT_BAN });
  if (unbanned.error) return failed(errors.accionFallo);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Purge (test data)
// ---------------------------------------------------------------------------
export type PurgaResumen = {
  objetos: number;
  documentos: number;
  hijos: number;
  solicitudes: number;
  eventos: number;
};

// Permanently removes an account: its storage objects, then the auth user.
// The database rows (profile, legajo, children, documents, requests, events)
// follow by cascade. Refused for the caller's own account, the last active
// Admin, and an account named in other accounts' history (uploads, reviews or
// account events), which the history must keep.
export async function purgarCuenta(input: {
  profileId: string;
  emailConfirmacion: string;
}): Promise<ActionResult<PurgaResumen>> {
  const admin = await requireAdmin();
  if (!admin) return failed(errors.noAutorizado);

  if (!uuidSchema.safeParse(input.profileId).success) return failed(errors.cuentaNoEncontrada);
  const profileId = input.profileId;
  if (profileId === admin.id) return failed(errors.cuentaPropia);

  const service = createAdminClient();
  const target = await service.auth.admin.getUserById(profileId);
  if (target.error || !target.data.user) return failed(errors.cuentaNoEncontrada);
  if (target.data.user.email !== input.emailConfirmacion) {
    return failed(errors.emailConfirmacionNoCoincide);
  }

  const profile = await service
    .from("profiles")
    .select("role, estado_cuenta, legajos (id)")
    .eq("id", profileId)
    .maybeSingle();
  if (profile.error || !profile.data) return failed(errors.cuentaNoEncontrada);

  if (profile.data.role === "admin" && profile.data.estado_cuenta === "activa") {
    const activeAdmins = await service
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("estado_cuenta", "activa");
    if (activeAdmins.error) return failed(errors.accionFallo);
    if ((activeAdmins.count ?? 0) <= 1) return failed(errors.ultimoAdmin);
  }

  const legajoId = profile.data.legajos?.id ?? null;
  const inOthersHistory = await countOthersHistory(service, profileId, legajoId);
  if (inOthersHistory === null) return failed(errors.accionFallo);
  if (inOthersHistory > 0) return failed(errors.historialEnOtrasCuentas);

  const resumen = await countOwnRows(service, profileId, legajoId);
  if (!resumen) return failed(errors.accionFallo);

  const paths = await listObjects(service, profileId);
  if (!paths) return failed(errors.accionFallo);
  for (let start = 0; start < paths.length; start += 100) {
    const removed = await service.storage.from(DOCUMENTOS_BUCKET).remove(paths.slice(start, start + 100));
    if (removed.error) return failed(errors.accionFallo);
  }

  const deleted = await service.auth.admin.deleteUser(profileId);
  if (deleted.error) return failed(errors.accionFallo);

  return { ok: true, data: { ...resumen, objetos: paths.length } };
}

// Rows of other accounts that name this profile. Null when a count fails.
async function countOthersHistory(
  service: ServiceClient,
  profileId: string,
  legajoId: string | null,
): Promise<number | null> {
  const otherLegajo = legajoId ?? "00000000-0000-0000-0000-000000000000";
  const results = await Promise.all([
    service
      .from("legajo_documentos")
      .select("id", { count: "exact", head: true })
      .or(`uploaded_by.eq.${profileId},revisado_por.eq.${profileId}`)
      .neq("legajo_id", otherLegajo),
    service
      .from("solicitudes_cambio")
      .select("id", { count: "exact", head: true })
      .eq("revisado_por", profileId)
      .neq("legajo_id", otherLegajo),
    service
      .from("cuenta_eventos")
      .select("id", { count: "exact", head: true })
      .eq("actor_id", profileId)
      .neq("profile_id", profileId),
  ]);
  if (results.some((result) => result.error)) return null;
  return results.reduce((total, result) => total + (result.count ?? 0), 0);
}

async function countOwnRows(
  service: ServiceClient,
  profileId: string,
  legajoId: string | null,
): Promise<Omit<PurgaResumen, "objetos"> | null> {
  const count = async (
    query: PromiseLike<{ count: number | null; error: unknown }>,
  ): Promise<number | null> => {
    const { count: value, error } = await query;
    return error ? null : (value ?? 0);
  };
  const byLegajo = legajoId ?? "00000000-0000-0000-0000-000000000000";
  const [documentos, hijos, solicitudes, eventos] = await Promise.all([
    count(service.from("legajo_documentos").select("id", { count: "exact", head: true }).eq("legajo_id", byLegajo)),
    count(service.from("legajo_hijos").select("id", { count: "exact", head: true }).eq("legajo_id", byLegajo)),
    count(service.from("solicitudes_cambio").select("id", { count: "exact", head: true }).eq("legajo_id", byLegajo)),
    count(service.from("cuenta_eventos").select("id", { count: "exact", head: true }).eq("profile_id", profileId)),
  ]);
  if (documentos === null || hijos === null || solicitudes === null || eventos === null) return null;
  return { documentos, hijos, solicitudes, eventos };
}

// Every object under <profileId>/ in the documents bucket, any depth.
// Null when a listing fails.
async function listObjects(service: ServiceClient, folder: string): Promise<string[] | null> {
  const bucket = service.storage.from(DOCUMENTOS_BUCKET);
  const paths: string[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await bucket.list(folder, { limit: pageSize, offset });
    if (error || !data) return null;
    for (const entry of data) {
      const path = `${folder}/${entry.name}`;
      // Folders have no id.
      if (entry.id === null) {
        const nested = await listObjects(service, path);
        if (!nested) return null;
        paths.push(...nested);
      } else {
        paths.push(path);
      }
    }
    if (data.length < pageSize) return paths;
  }
}
