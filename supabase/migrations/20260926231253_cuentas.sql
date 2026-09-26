-- F1-07A: account status, forced password change and account history
-- (Constitution §10, PRD US-8 and US-9).

-- ---------------------------------------------------------------------------
-- Enums (stable codes; display labels live in the copy module)
-- ---------------------------------------------------------------------------
create type public.cuenta_estado as enum ('activa', 'inactiva');

create type public.cuenta_evento_tipo as enum (
  'creacion',
  'desactivacion',
  'reactivacion',
  'password_temporal',
  'password_cambiada'
);

-- ---------------------------------------------------------------------------
-- Profiles: account state and forced password change
-- ---------------------------------------------------------------------------
-- Not in any column grant: they change only through the functions below.
alter table public.profiles
  add column estado_cuenta public.cuenta_estado not null default 'activa',
  add column debe_cambiar_password boolean not null default false;

-- An inactive Admin loses Admin rights at once, even with an access token that
-- has not expired yet. Every policy and guard that uses is_admin() follows.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.role = 'admin'::public.app_role and p.estado_cuenta = 'activa'::public.cuenta_estado
      from public.profiles as p
      where p.id = auth.uid()
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Account history
-- ---------------------------------------------------------------------------
-- Written only by the functions below. Removed only by purge (profile cascade).
create table public.cuenta_eventos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  tipo public.cuenta_evento_tipo not null,
  motivo text,
  -- Who performed it; the user's own id when they act on themselves. Deferred
  -- so a profile's own events (where it is also the actor) cascade on delete.
  -- A profile that acted on other accounts cannot be deleted: its name stays
  -- in their history.
  actor_id uuid not null references public.profiles (id) deferrable initially deferred,
  created_at timestamptz not null default now(),

  -- A reason, with at least one non-whitespace character, exactly for deactivation.
  constraint cuenta_eventos_motivo
    check (
      (tipo = 'desactivacion' and motivo is not null and motivo ~ '[^[:space:]]')
      or (tipo <> 'desactivacion' and motivo is null)
    )
);

create index cuenta_eventos_profile_id_idx on public.cuenta_eventos (profile_id);
create index cuenta_eventos_actor_id_idx on public.cuenta_eventos (actor_id);

alter table public.cuenta_eventos enable row level security;

revoke all on table public.cuenta_eventos from anon, authenticated;
grant select on table public.cuenta_eventos to authenticated;

create policy cuenta_eventos_select_own_or_admin
  on public.cuenta_eventos
  for select
  to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

-- INSERT, UPDATE, DELETE: no policy and no grant.

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: they write columns and rows the API roles cannot.
-- Error codes: 42501 not allowed; 22023 blank reason; P0002 account not found;
-- 55000 business rule, with a stable HINT the application maps to its copy:
-- cuenta_propia, ultimo_admin, ya_inactiva, ya_activa.

-- Ends every session of a user: the refresh tokens go with their sessions,
-- as in the Auth server's own logout. Access tokens already issued expire on
-- their own (jwt_expiry); the app gate signs the user out before that.
create function public.cerrar_sesiones_cuenta(p_profile_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = p_profile_id;
$$;

-- Internal: only the functions below call it.
revoke execute on function public.cerrar_sesiones_cuenta(uuid) from public, anon, authenticated;

create function public.desactivar_cuenta(p_profile_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cuenta public.profiles%rowtype;
  admins_activos integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can deactivate accounts' using errcode = '42501';
  end if;
  if p_motivo is null or p_motivo !~ '[^[:space:]]' then
    raise exception 'A deactivation reason is required' using errcode = '22023';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'An account cannot be deactivated by itself'
      using errcode = '55000', hint = 'cuenta_propia';
  end if;

  -- Locks every active Admin, so two deactivations cannot race past the
  -- last-admin rule.
  perform 1
  from public.profiles as p
  where p.role = 'admin' and p.estado_cuenta = 'activa'
  for update;

  select * into cuenta from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if cuenta.estado_cuenta = 'inactiva' then
    raise exception 'Account is already inactive' using errcode = '55000', hint = 'ya_inactiva';
  end if;

  if cuenta.role = 'admin' then
    select pg_catalog.count(*) into admins_activos
    from public.profiles as p
    where p.role = 'admin' and p.estado_cuenta = 'activa';
    if admins_activos <= 1 then
      raise exception 'The last active admin cannot be deactivated'
        using errcode = '55000', hint = 'ultimo_admin';
    end if;
  end if;

  update public.profiles set estado_cuenta = 'inactiva' where id = p_profile_id;

  insert into public.cuenta_eventos (profile_id, tipo, motivo, actor_id)
  values (p_profile_id, 'desactivacion', pg_catalog.btrim(p_motivo), auth.uid());

  perform public.cerrar_sesiones_cuenta(p_profile_id);
end;
$$;

create function public.reactivar_cuenta(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cuenta public.profiles%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reactivate accounts' using errcode = '42501';
  end if;

  select * into cuenta from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if cuenta.estado_cuenta = 'activa' then
    raise exception 'Account is already active' using errcode = '55000', hint = 'ya_activa';
  end if;

  update public.profiles set estado_cuenta = 'activa' where id = p_profile_id;

  insert into public.cuenta_eventos (profile_id, tipo, actor_id)
  values (p_profile_id, 'reactivacion', auth.uid());
end;
$$;

-- After an Admin sets a temporary password: the user must change it at the
-- next login, and their current sessions end. Never on the caller's own
-- account: an Admin changes their own password at /cambiar-password.
create function public.marcar_password_temporal(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can set a temporary password' using errcode = '42501';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'A temporary password cannot be set on the own account'
      using errcode = '55000', hint = 'cuenta_propia';
  end if;

  update public.profiles set debe_cambiar_password = true where id = p_profile_id;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  insert into public.cuenta_eventos (profile_id, tipo, actor_id)
  values (p_profile_id, 'password_temporal', auth.uid());

  perform public.cerrar_sesiones_cuenta(p_profile_id);
end;
$$;

-- The caller, on their own account, after changing their password.
create function public.confirmar_cambio_password()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  update public.profiles set debe_cambiar_password = false where id = caller;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  insert into public.cuenta_eventos (profile_id, tipo, actor_id)
  values (caller, 'password_cambiada', caller);
end;
$$;

-- After an Admin creates an account with a temporary password.
create function public.registrar_creacion_cuenta(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can register an account' using errcode = '42501';
  end if;

  update public.profiles set debe_cambiar_password = true where id = p_profile_id;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  insert into public.cuenta_eventos (profile_id, tipo, actor_id)
  values (p_profile_id, 'creacion', auth.uid());
end;
$$;

revoke execute on function public.desactivar_cuenta(uuid, text) from public, anon;
revoke execute on function public.reactivar_cuenta(uuid) from public, anon;
revoke execute on function public.marcar_password_temporal(uuid) from public, anon;
revoke execute on function public.confirmar_cambio_password() from public, anon;
revoke execute on function public.registrar_creacion_cuenta(uuid) from public, anon;
grant execute on function public.desactivar_cuenta(uuid, text) to authenticated;
grant execute on function public.reactivar_cuenta(uuid) to authenticated;
grant execute on function public.marcar_password_temporal(uuid) to authenticated;
grant execute on function public.confirmar_cambio_password() to authenticated;
grant execute on function public.registrar_creacion_cuenta(uuid) to authenticated;
