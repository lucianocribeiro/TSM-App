-- F1-03: profiles, roles, role helper functions and base RLS.

-- ---------------------------------------------------------------------------
-- Role enum
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('empleado', 'admin');

-- ---------------------------------------------------------------------------
-- Profiles: one row per auth user
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'empleado',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Table privileges. RLS policies below decide which rows are reachable.
-- anon: no access. authenticated: read, and update of `role` only (the UPDATE
-- policy limits it to Admin). No INSERT or DELETE for API roles: rows come from
-- the auth.users trigger and go through the auth.users cascade.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (role) on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profile creation on sign-up
-- ---------------------------------------------------------------------------
-- Always creates the profile as 'empleado'. User or app metadata sent at
-- sign-up is ignored on purpose: only an Admin can promote a user.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'empleado'::public.app_role);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Role helper functions (used by every policy; no duplicated role logic)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so policies on public.profiles can call them without
-- recursing into their own RLS. They only ever read the caller's own row.
create function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = auth.uid();
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'admin'::public.app_role, false);
$$;

revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Policies on public.profiles
-- ---------------------------------------------------------------------------
-- SELECT: own row, or any row for Admin.
create policy profiles_select_own_or_admin
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

-- UPDATE: Admin only. Empleado cannot update any profile, including their own.
create policy profiles_update_admin
  on public.profiles
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- INSERT: no policy (rows come only from on_auth_user_created).
-- DELETE: no policy (rows go only through the auth.users cascade).
