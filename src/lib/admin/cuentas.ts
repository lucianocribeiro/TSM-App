import "server-only";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { passwordSchema } from "@/lib/auth/password";
import { copy } from "@/lib/copy/es-AR";
import { nombreCompleto, type CuentaListItem } from "@/lib/cuentas/listado";
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
    case "email_no_coincide":
      return errors.emailConfirmacionNoCoincide;
    case "historial_otras_cuentas":
      return errors.historialEnOtrasCuentas;
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
// List (read only)
// ---------------------------------------------------------------------------
// Every account, for the Usuarios screen. Emails live only in Auth, so they
// come from the Auth Admin API; role, state and the pending password change
// (profiles) and the name (legajos) are read with the Admin's own session,
// under RLS.
export async function listarCuentas(): Promise<ActionResult<CuentaListItem[]>> {
  const admin = await requireAdmin();
  if (!admin) return failed(errors.noAutorizado);

  const [profiles, legajos] = await Promise.all([
    admin.session.from("profiles").select("id, role, estado_cuenta, debe_cambiar_password"),
    admin.session.from("legajos").select("profile_id, nombres, apellido"),
  ]);
  if (profiles.error || legajos.error) return failed(errors.accionFallo);

  const emails = await listAuthEmails(createAdminClient());
  if (!emails) return failed(errors.accionFallo);

  const nombres = new Map(
    (legajos.data ?? []).map((legajo) => [legajo.profile_id, nombreCompleto(legajo.nombres, legajo.apellido)]),
  );
  const cuentas = (profiles.data ?? []).map((profile) => ({
    id: profile.id,
    email: emails.get(profile.id) ?? "",
    rol: profile.role,
    estado: profile.estado_cuenta,
    debeCambiarPassword: profile.debe_cambiar_password,
    nombre: nombres.get(profile.id) ?? null,
  }));
  return { ok: true, data: cuentas };
}

// Auth user id -> email, every page. Null when a page fails.
async function listAuthEmails(service: ServiceClient): Promise<Map<string, string> | null> {
  const emails = new Map<string, string>();
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    for (const user of data.users) emails.set(user.id, user.email ?? "");
    if (data.users.length < perPage) return emails;
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
// Never on the caller's own account: an Admin changes their own password at
// /cambiar-password.
export async function resetPasswordTemporal(input: {
  profileId: string;
  passwordTemporal: string;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return failed(errors.noAutorizado);

  if (!uuidSchema.safeParse(input.profileId).success) return failed(errors.cuentaNoEncontrada);
  if (input.profileId === admin.id) return failed(errors.cuentaPropia);
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
//
// Safe to retry: when a previous run deactivated the account but the ban
// failed, desactivar_cuenta refuses the already-inactive account (and records
// nothing); the missing ban is then applied and the retry succeeds. An account
// that is already inactive and banned still gets "ya inactiva".
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
  const service = createAdminClient();

  if (deactivated.error) {
    if (deactivated.error.hint !== "ya_inactiva") return failed(cuentaErrorMessage(deactivated.error));
    const target = await service.auth.admin.getUserById(input.profileId);
    if (target.error || !target.data.user) return failed(errors.accionFallo);
    if (isBanned(target.data.user.banned_until)) return failed(errors.yaInactiva);
  }

  const banned = await service.auth.admin.updateUserById(input.profileId, {
    ban_duration: BAN_UNTIL_REACTIVATED,
  });
  if (banned.error) return failed(errors.accionFallo);

  return { ok: true };
}

function isBanned(bannedUntil: string | undefined): boolean {
  return Boolean(bannedUntil) && new Date(bannedUntil ?? 0).getTime() > Date.now();
}

// Safe to retry, mirroring desactivarCuenta: when a previous run reactivated
// the account but lifting the ban failed, reactivar_cuenta refuses the
// already-active account (and records nothing); the ban is then lifted and
// the retry succeeds. An account that is active and not banned still gets
// "ya activa".
export async function reactivarCuenta(input: { profileId: string }): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return failed(errors.noAutorizado);

  if (!uuidSchema.safeParse(input.profileId).success) return failed(errors.cuentaNoEncontrada);

  const reactivated = await admin.session.rpc("reactivar_cuenta", { p_profile_id: input.profileId });
  const service = createAdminClient();

  if (reactivated.error) {
    if (reactivated.error.hint !== "ya_activa") return failed(cuentaErrorMessage(reactivated.error));
    const target = await service.auth.admin.getUserById(input.profileId);
    if (target.error || !target.data.user) return failed(errors.accionFallo);
    if (!isBanned(target.data.user.banned_until)) return failed(errors.yaActiva);
  }

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

// Permanently removes an account, in three steps:
// 1. public.purgar_cuenta, in one database transaction: every guard (active
//    Admin caller, not the caller's own account, exact confirmation email,
//    not the last active Admin, not named in other accounts' history) under
//    the Admin row lock, then the profile row with its cascade (legajo,
//    children, documents, requests, items, account events);
// 2. the storage objects under the account's folder;
// 3. the Auth user.
// Nothing is removed before the database has checked every guard, so two
// concurrent purges cannot both pass the last-Admin rule.
//
// Safe to retry after a partial failure: when step 1 already ran, the
// profile is gone and purgar_cuenta answers P0002; the Auth user still exists,
// its email is checked again, and steps 2 and 3 run. Objects are listed at the
// time of the run, so files a previous run removed are simply not there. The
// counts report what this run removed.
const resumenSchema = z.object({
  documentos: z.number(),
  hijos: z.number(),
  solicitudes: z.number(),
  eventos: z.number(),
});

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

  let resumen: Omit<PurgaResumen, "objetos">;
  const purged = await admin.session.rpc("purgar_cuenta", {
    p_profile_id: profileId,
    p_email_confirmacion: input.emailConfirmacion,
  });
  if (purged.error) {
    // P0002: a previous run already removed the profile; finish the rest.
    if (purged.error.code !== "P0002") return failed(cuentaErrorMessage(purged.error));
    resumen = { documentos: 0, hijos: 0, solicitudes: 0, eventos: 0 };
  } else {
    const parsed = resumenSchema.safeParse(purged.data);
    if (!parsed.success) return failed(errors.accionFallo);
    resumen = parsed.data;
  }

  const paths = await listObjects(service, profileId);
  if (!paths) return failed(errors.accionFallo);
  let objetos = 0;
  for (let start = 0; start < paths.length; start += 100) {
    const removed = await service.storage.from(DOCUMENTOS_BUCKET).remove(paths.slice(start, start + 100));
    if (removed.error) return failed(errors.accionFallo);
    objetos += removed.data?.length ?? 0;
  }

  const deleted = await service.auth.admin.deleteUser(profileId);
  if (deleted.error) return failed(errors.accionFallo);

  return { ok: true, data: { ...resumen, objetos } };
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
