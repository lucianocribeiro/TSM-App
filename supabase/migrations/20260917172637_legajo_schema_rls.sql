-- F1-05: legajo schema (PRD section 5), children, access rules and RLS.

-- ---------------------------------------------------------------------------
-- Enums (stable codes; display labels live in the copy module)
-- ---------------------------------------------------------------------------
create type public.estado_civil as enum (
  'soltero',
  'casado',
  'divorciado',
  'viudo',
  'union_convivencial'
);

-- "en_licencia" is added with the Licencias module (Fase 3).
create type public.estado_laboral as enum ('activo', 'en_prueba');

-- ---------------------------------------------------------------------------
-- Legajos: one row per employee
-- ---------------------------------------------------------------------------
-- Data columns are nullable: a legajo is created empty and completed later.
-- Required-field rules live in the shared server validation
-- (src/lib/legajo/validation.ts). Only always-true rules are constraints here.
create table public.legajos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,

  -- Group A: Datos personales
  nombres text,
  apellido text,
  dni text,
  nacionalidad text,
  cuil text,
  fecha_nacimiento date,

  -- Group B: Domicilio y contacto
  calle_altura text,
  piso_depto text,
  localidad text,
  partido text,
  partido_otro text,
  telefono_celular text,
  email_personal text,

  -- Group C: Datos familiares (children in public.legajo_hijos)
  estado_civil public.estado_civil,
  nombre_conyuge text,
  tiene_hijos boolean,

  -- Group D: Datos de emergencia
  grupo_sanguineo text,
  alergias text,
  medicacion_habitual text,
  obra_social text,
  numero_afiliado text,
  emergencia_nombre text,
  emergencia_parentesco text,
  emergencia_domicilio text,
  emergencia_telefono text,

  -- Group E: Datos laborales (Admin-only edits). Antigüedad is not stored.
  numero_legajo text unique,
  area text,
  puesto text,
  fecha_ingreso date,
  estado_laboral public.estado_laboral,
  sede text,
  modalidad text,
  convenio text,
  bruto_mensual numeric(14, 2),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint legajos_dni_digits
    check (dni is null or dni ~ '^[0-9]+$'),

  constraint legajos_partido_valido
    check (
      partido is null or partido in (
        'General San Martín', 'CABA', 'Almirante Brown', 'Avellaneda',
        'Berazategui', 'Berisso', 'Brandsen', 'Campana', 'Cañuelas', 'Ensenada',
        'Escobar', 'Esteban Echeverría', 'Exaltación de la Cruz', 'Ezeiza',
        'Florencio Varela', 'General Las Heras', 'General Rodríguez', 'Hurlingham',
        'Ituzaingó', 'José C. Paz', 'La Matanza', 'La Plata', 'Lanús',
        'Lomas de Zamora', 'Luján', 'Malvinas Argentinas', 'Marcos Paz', 'Merlo',
        'Moreno', 'Morón', 'Pilar', 'Presidente Perón', 'Quilmes', 'San Fernando',
        'San Isidro', 'San Miguel', 'San Vicente', 'Tigre', 'Tres de Febrero',
        'Vicente López', 'Zárate', 'Otro'
      )
    ),

  -- partido_otro is present (non-empty) exactly when partido = 'Otro'.
  constraint legajos_partido_otro
    check (
      (partido = 'Otro' and partido_otro is not null and btrim(partido_otro) <> '')
      or (partido is distinct from 'Otro' and partido_otro is null)
    ),

  constraint legajos_bruto_mensual_no_negativo
    check (bruto_mensual is null or bruto_mensual >= 0)
);

alter table public.legajos enable row level security;

create trigger legajos_set_updated_at
  before update on public.legajos
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Legajo children
-- ---------------------------------------------------------------------------
create table public.legajo_hijos (
  id uuid primary key default gen_random_uuid(),
  legajo_id uuid not null references public.legajos (id) on delete cascade,
  nombre_completo text not null,
  fecha_nacimiento date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index legajo_hijos_legajo_id_idx on public.legajo_hijos (legajo_id);

alter table public.legajo_hijos enable row level security;

create trigger legajo_hijos_set_updated_at
  before update on public.legajo_hijos
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Automatic empty legajo per profile
-- ---------------------------------------------------------------------------
create function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.legajos (profile_id)
  values (new.id);
  return new;
end;
$$;

revoke execute on function public.handle_new_profile() from public, anon, authenticated;

create trigger on_profile_created_create_legajo
  after insert on public.profiles
  for each row
  execute function public.handle_new_profile();

-- Profiles that existed before this migration also get their empty legajo.
insert into public.legajos (profile_id)
select p.id
from public.profiles as p
on conflict (profile_id) do nothing;

-- ---------------------------------------------------------------------------
-- Group E protection
-- ---------------------------------------------------------------------------
-- Only Admin changes group E through the API. Requests without JWT claims
-- (direct database connections: migrations, seeds) and the service role
-- (system jobs) are not API users and are allowed.
create function public.protect_legajo_laboral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_role text := auth.jwt() ->> 'role';
begin
  if public.is_admin() or jwt_role is null or jwt_role = 'service_role' then
    return new;
  end if;

  if new.numero_legajo is distinct from old.numero_legajo
    or new.area is distinct from old.area
    or new.puesto is distinct from old.puesto
    or new.fecha_ingreso is distinct from old.fecha_ingreso
    or new.estado_laboral is distinct from old.estado_laboral
    or new.sede is distinct from old.sede
    or new.modalidad is distinct from old.modalidad
    or new.convenio is distinct from old.convenio
    or new.bruto_mensual is distinct from old.bruto_mensual
  then
    raise exception 'Only an admin can change datos laborales'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_legajo_laboral() from public, anon, authenticated;

create trigger legajos_protect_laboral
  before update on public.legajos
  for each row
  execute function public.protect_legajo_laboral();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on table public.legajos from anon, authenticated;
revoke all on table public.legajo_hijos from anon, authenticated;

grant select on table public.legajos to authenticated;

grant insert (
  profile_id,
  nombres, apellido, dni, nacionalidad, cuil, fecha_nacimiento,
  calle_altura, piso_depto, localidad, partido, partido_otro, telefono_celular, email_personal,
  estado_civil, nombre_conyuge, tiene_hijos,
  grupo_sanguineo, alergias, medicacion_habitual, obra_social, numero_afiliado,
  emergencia_nombre, emergencia_parentesco, emergencia_domicilio, emergencia_telefono,
  numero_legajo, area, puesto, fecha_ingreso, estado_laboral, sede, modalidad, convenio, bruto_mensual
) on table public.legajos to authenticated;

-- Data columns only: never id, profile_id or timestamps.
grant update (
  nombres, apellido, dni, nacionalidad, cuil, fecha_nacimiento,
  calle_altura, piso_depto, localidad, partido, partido_otro, telefono_celular, email_personal,
  estado_civil, nombre_conyuge, tiene_hijos,
  grupo_sanguineo, alergias, medicacion_habitual, obra_social, numero_afiliado,
  emergencia_nombre, emergencia_parentesco, emergencia_domicilio, emergencia_telefono,
  numero_legajo, area, puesto, fecha_ingreso, estado_laboral, sede, modalidad, convenio, bruto_mensual
) on table public.legajos to authenticated;

grant select, delete on table public.legajo_hijos to authenticated;
grant insert (legajo_id, nombre_completo, fecha_nacimiento)
  on table public.legajo_hijos to authenticated;
grant update (legajo_id, nombre_completo, fecha_nacimiento)
  on table public.legajo_hijos to authenticated;

-- ---------------------------------------------------------------------------
-- Policies: legajos
-- ---------------------------------------------------------------------------
create policy legajos_select_own_or_admin
  on public.legajos
  for select
  to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

create policy legajos_update_own_or_admin
  on public.legajos
  for update
  to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()))
  with check (profile_id = (select auth.uid()) or (select public.is_admin()));

create policy legajos_insert_admin
  on public.legajos
  for insert
  to authenticated
  with check ((select public.is_admin()));

-- DELETE: no policy (removal only through the profile cascade).

-- ---------------------------------------------------------------------------
-- Policies: legajo_hijos (parent legajo owned by the caller, or Admin)
-- ---------------------------------------------------------------------------
-- The subquery reads public.legajos under its own RLS, so it only finds the
-- caller's legajo (or any legajo for Admin).
create policy legajo_hijos_select_own_or_admin
  on public.legajo_hijos
  for select
  to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.legajos as l
      where l.id = legajo_id and l.profile_id = (select auth.uid())
    )
  );

create policy legajo_hijos_insert_own_or_admin
  on public.legajo_hijos
  for insert
  to authenticated
  with check (
    (select public.is_admin())
    or exists (
      select 1 from public.legajos as l
      where l.id = legajo_id and l.profile_id = (select auth.uid())
    )
  );

-- WITH CHECK also runs on the new legajo_id, so a child cannot be moved to
-- another employee's legajo.
create policy legajo_hijos_update_own_or_admin
  on public.legajo_hijos
  for update
  to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.legajos as l
      where l.id = legajo_id and l.profile_id = (select auth.uid())
    )
  )
  with check (
    (select public.is_admin())
    or exists (
      select 1 from public.legajos as l
      where l.id = legajo_id and l.profile_id = (select auth.uid())
    )
  );

create policy legajo_hijos_delete_own_or_admin
  on public.legajo_hijos
  for delete
  to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.legajos as l
      where l.id = legajo_id and l.profile_id = (select auth.uid())
    )
  );
