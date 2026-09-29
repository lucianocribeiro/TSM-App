-- F1-11A: an inactive account is refused by the database, not only by the app
-- (Constitution §4 and §10, v0.6; PRD US-2, US-8, US-11).
--
-- Deactivating an account closes its sessions, but an access token issued
-- before stays valid until it expires (jwt_expiry). Until now the database
-- only took Admin rights away (is_admin); an inactive user could still read
-- their own rows and files through PostgREST and Storage in that window. From
-- here, a caller whose account is not active reaches nothing, with one
-- exception: their own profiles row, so the app can read the state and show
-- the "cuenta desactivada" message.
--
-- How: the active rule lives in current_app_role(), which returns no role for
-- a caller whose account is not active. is_admin() and the new cuenta_activa()
-- derive from it, so every policy and function built on them follows. The
-- ownership branches of the policies (auth.uid() = owner) now also require
-- cuenta_activa(). Functions callable by authenticated refuse a non-active
-- caller with 42501 before any read or write, as they refuse the wrong role.
--
-- A pending forced password change is enforced by the app (proxy and Server
-- Actions), not here, by design: that user is the legitimate owner of the
-- data and the database treats them as any active user.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- The caller's role, only while their account is active. Null otherwise (no
-- session, no profile, or an inactive account).
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = auth.uid()
    and p.estado_cuenta = 'activa'::public.cuenta_estado;
$$;

-- Same result as F1-07A, now through the single active rule above.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'admin'::public.app_role, false);
$$;

-- The caller's account is active (any role). Used by the ownership branches
-- of the policies below.
create function public.cuenta_activa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_app_role() is not null;
$$;

-- Policies run it as the caller.
revoke execute on function public.cuenta_activa() from public, anon;
grant execute on function public.cuenta_activa() to authenticated;

-- ---------------------------------------------------------------------------
-- Policies: the own-data branch requires an active account
-- ---------------------------------------------------------------------------
-- Unchanged, because they already go through is_admin(): profiles_update_admin,
-- legajos_update_admin, legajos_insert_admin, legajo_hijos_insert_admin,
-- legajo_hijos_update_admin, legajo_hijos_delete_admin and
-- legajo_documentos_update_admin.
--
-- Unchanged on purpose: profiles_select_own_or_admin. An inactive user still
-- reads their own profiles row (and nothing else).

-- legajos
drop policy legajos_select_own_or_admin on public.legajos;

create policy legajos_select_own_or_admin
  on public.legajos
  for select
  to authenticated
  using (
    (select public.is_admin())
    or (profile_id = (select auth.uid()) and (select public.cuenta_activa()))
  );

-- legajo_hijos
drop policy legajo_hijos_select_own_or_admin on public.legajo_hijos;

create policy legajo_hijos_select_own_or_admin
  on public.legajo_hijos
  for select
  to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.cuenta_activa())
      and exists (
        select 1 from public.legajos as l
        where l.id = legajo_id and l.profile_id = (select auth.uid())
      )
    )
  );

-- legajo_documentos
drop policy legajo_documentos_select_own_or_admin on public.legajo_documentos;
drop policy legajo_documentos_insert_own_or_admin on public.legajo_documentos;
drop policy legajo_documentos_delete_admin_or_own_pending on public.legajo_documentos;

create policy legajo_documentos_select_own_or_admin
  on public.legajo_documentos
  for select
  to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.cuenta_activa())
      and estado <> 'reemplazado'
      and exists (
        select 1 from public.legajos as l
        where l.id = legajo_id and l.profile_id = (select auth.uid())
      )
    )
  );

-- As in F1-06B, plus the active account (an Admin is always active).
create policy legajo_documentos_insert_own_or_admin
  on public.legajo_documentos
  for insert
  to authenticated
  with check (
    (select public.cuenta_activa())
    and uploaded_by = (select auth.uid())
    and estado = (
      case when (select public.is_admin())
        then 'aprobado'::public.documento_estado
        else 'pendiente'::public.documento_estado
      end
    )
    and exists (
      select 1 from public.legajos as l
      where l.id = legajo_id
        and (l.profile_id = (select auth.uid()) or (select public.is_admin()))
        and split_part(storage_path, '/', 1) = l.profile_id::text
    )
  );

create policy legajo_documentos_delete_admin_or_own_pending
  on public.legajo_documentos
  for delete
  to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.cuenta_activa())
      and estado = 'pendiente'
      and exists (
        select 1 from public.legajos as l
        where l.id = legajo_id and l.profile_id = (select auth.uid())
      )
    )
  );

-- solicitudes_cambio
drop policy solicitudes_cambio_select_own_or_admin on public.solicitudes_cambio;
drop policy solicitudes_cambio_cancel_own on public.solicitudes_cambio;

create policy solicitudes_cambio_select_own_or_admin
  on public.solicitudes_cambio
  for select
  to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.cuenta_activa())
      and exists (
        select 1 from public.legajos as l
        where l.id = legajo_id and l.profile_id = (select auth.uid())
      )
    )
  );

create policy solicitudes_cambio_cancel_own
  on public.solicitudes_cambio
  for update
  to authenticated
  using (
    estado = 'pendiente'
    and solicitado_por = (select auth.uid())
    and (select public.cuenta_activa())
  )
  with check (
    estado = 'cancelada'
    and solicitado_por = (select auth.uid())
    and (select public.cuenta_activa())
  );

-- solicitudes_cambio_items
drop policy solicitudes_cambio_items_select_own_or_admin on public.solicitudes_cambio_items;

create policy solicitudes_cambio_items_select_own_or_admin
  on public.solicitudes_cambio_items
  for select
  to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.cuenta_activa())
      and exists (
        select 1
        from public.solicitudes_cambio as s
        join public.legajos as l on l.id = s.legajo_id
        where s.id = solicitud_id and l.profile_id = (select auth.uid())
      )
    )
  );

-- cuenta_eventos
drop policy cuenta_eventos_select_own_or_admin on public.cuenta_eventos;

create policy cuenta_eventos_select_own_or_admin
  on public.cuenta_eventos
  for select
  to authenticated
  using (
    (select public.is_admin())
    or (profile_id = (select auth.uid()) and (select public.cuenta_activa()))
  );

-- ---------------------------------------------------------------------------
-- estado_documento_propio: nothing for an inactive caller
-- ---------------------------------------------------------------------------
-- A policy helper, so it answers null (no document) instead of raising: an
-- error would turn a denied storage read into a failed one.
create or replace function public.estado_documento_propio(p_storage_path text)
returns public.documento_estado
language sql
stable
security definer
set search_path = ''
as $$
  select d.estado
  from public.legajo_documentos as d
  where d.storage_path = p_storage_path
    and pg_catalog.split_part(p_storage_path, '/', 1) = (select auth.uid())::text
    and public.cuenta_activa();
$$;

-- ---------------------------------------------------------------------------
-- Storage policies (bucket legajo-docs): the own-folder branch requires an
-- active account. Otherwise as in F1-06 and F1-09B.
-- ---------------------------------------------------------------------------
drop policy legajo_docs_select_own_or_admin on storage.objects;
drop policy legajo_docs_insert_own_or_admin on storage.objects;
drop policy legajo_docs_update_admin_or_own_pending on storage.objects;
drop policy legajo_docs_delete_admin_or_own_pending on storage.objects;

create policy legajo_docs_select_own_or_admin
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'legajo-docs'
    and (
      (select public.is_admin())
      or (
        (select public.cuenta_activa())
        and split_part(objects.name, '/', 1) = (select auth.uid())::text
        and public.estado_documento_propio(objects.name) is distinct from 'reemplazado'
      )
    )
  );

create policy legajo_docs_insert_own_or_admin
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'legajo-docs'
    and public.is_valid_legajo_doc_path(objects.name)
    and (
      (
        (select public.cuenta_activa())
        and split_part(objects.name, '/', 1) = (select auth.uid())::text
      )
      or (
        (select public.is_admin())
        and exists (
          select 1 from public.profiles as p
          where p.id::text = split_part(objects.name, '/', 1)
        )
      )
    )
  );

create policy legajo_docs_update_admin_or_own_pending
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'legajo-docs'
    and (
      (select public.is_admin())
      or (
        (select public.cuenta_activa())
        and split_part(objects.name, '/', 1) = (select auth.uid())::text
        and coalesce(public.estado_documento_propio(objects.name), 'pendiente') = 'pendiente'
      )
    )
  )
  with check (
    bucket_id = 'legajo-docs'
    and public.is_valid_legajo_doc_path(objects.name)
    and (
      (
        (select public.cuenta_activa())
        and split_part(objects.name, '/', 1) = (select auth.uid())::text
      )
      or (
        (select public.is_admin())
        and exists (
          select 1 from public.profiles as p
          where p.id::text = split_part(objects.name, '/', 1)
        )
      )
    )
  );

create policy legajo_docs_delete_admin_or_own_pending
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'legajo-docs'
    and (
      (select public.is_admin())
      or (
        (select public.cuenta_activa())
        and split_part(objects.name, '/', 1) = (select auth.uid())::text
        and coalesce(public.estado_documento_propio(objects.name), 'pendiente') = 'pendiente'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Functions callable by authenticated
-- ---------------------------------------------------------------------------
-- Already refuse a non-active caller first, with 42501, through the helpers:
-- crear_solicitud (current_app_role), and aprobar_solicitud,
-- rechazar_solicitud, aprobar_documento, rechazar_documento,
-- reemplazar_documento, pendientes_admin, desactivar_cuenta, reactivar_cuenta,
-- marcar_password_temporal, registrar_creacion_cuenta and purgar_cuenta
-- (is_admin). confirmar_cambio_password only checked for a session: it now
-- refuses an inactive account too.
create or replace function public.confirmar_cambio_password()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if not public.cuenta_activa() then
    raise exception 'Only an active account can confirm a password change' using errcode = '42501';
  end if;

  update public.profiles set debe_cambiar_password = false where id = caller;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  insert into public.cuenta_eventos (profile_id, tipo, actor_id)
  values (caller, 'password_cambiada', caller);
end;
$$;

-- Trigger and internal functions, checked for a bypass (none found, nothing
-- changes): handle_new_user and handle_new_profile run only on an auth.users
-- insert (Auth server, service role); set_updated_at, protect_legajo_laboral,
-- bloquear_legajo_pendiente and bloquear_hijos_pendiente only stamp or refuse
-- a write that the policies already allowed; set_documento_estado_inicial and
-- restamp_documento_reemplazo set review columns on writes the policies allow
-- (WITH CHECK runs after them); set_solicitud_item_valor_anterior runs only
-- inside crear_solicitud; cerrar_sesiones_cuenta and hay_solicitud_pendiente
-- are not executable by API roles.
