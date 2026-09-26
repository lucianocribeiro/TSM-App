-- F1-06B: approval of employee changes and documents (Constitution §9, PRD US-7).
-- An Empleado's changes to groups A to D and their document uploads are stored
-- as pending and take effect only when an Admin approves them. Admin changes
-- apply directly.

-- ---------------------------------------------------------------------------
-- Enums (stable codes; display labels live in the copy module)
-- ---------------------------------------------------------------------------
create type public.solicitud_estado as enum (
  'pendiente',
  'aprobada',
  'rechazada',
  'cancelada'
);

-- 'reemplazado': a previously approved document superseded by a newer
-- approved one. The row and its object are kept for history.
create type public.documento_estado as enum (
  'pendiente',
  'aprobado',
  'rechazado',
  'reemplazado'
);

-- ---------------------------------------------------------------------------
-- Allow-list of approvable fields
-- ---------------------------------------------------------------------------
-- Group A to D data columns of public.legajos, plus 'hijos' for the whole
-- children set. Never group E, id, profile_id or timestamps. Mirrors
-- src/lib/aprobaciones/campos.ts (an integration test compares both).
create function public.campos_solicitud_permitidos()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'nombres', 'apellido', 'dni', 'nacionalidad', 'cuil', 'fecha_nacimiento',
    'calle_altura', 'piso_depto', 'localidad', 'partido', 'partido_otro',
    'telefono_celular', 'email_personal',
    'estado_civil', 'nombre_conyuge', 'tiene_hijos', 'hijos',
    'grupo_sanguineo', 'alergias', 'medicacion_habitual', 'obra_social',
    'numero_afiliado', 'emergencia_nombre', 'emergencia_parentesco',
    'emergencia_domicilio', 'emergencia_telefono'
  ]::text[];
$$;

-- The children set as JSON: an array of objects with exactly
-- nombre_completo (non-blank string) and fecha_nacimiento (YYYY-MM-DD).
-- Mirrors hijosValorSchema in src/lib/aprobaciones/solicitudes.ts.
create function public.is_valid_hijos_json(valor text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  hijos jsonb;
  hijo jsonb;
begin
  if valor is null or not pg_catalog.pg_input_is_valid(valor, 'jsonb') then
    return false;
  end if;

  hijos := valor::jsonb;
  if pg_catalog.jsonb_typeof(hijos) <> 'array' then
    return false;
  end if;

  for hijo in select value from pg_catalog.jsonb_array_elements(hijos) loop
    if pg_catalog.jsonb_typeof(hijo) <> 'object'
      or (
        select pg_catalog.array_agg(key order by key)
        from pg_catalog.jsonb_object_keys(hijo) as key
      ) is distinct from array['fecha_nacimiento', 'nombre_completo']::text[]
      or pg_catalog.jsonb_typeof(hijo -> 'nombre_completo') <> 'string'
      or pg_catalog.jsonb_typeof(hijo -> 'fecha_nacimiento') <> 'string'
      or (hijo ->> 'nombre_completo') !~ '[^[:space:]]'
      or (hijo ->> 'fecha_nacimiento') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or not pg_catalog.pg_input_is_valid(hijo ->> 'fecha_nacimiento', 'date')
    then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

-- A proposed value can be stored in its legajo column. Content rules
-- (DNI digits, partido list, partido_otro) are the legajos constraints, which
-- run when the request is approved.
create function public.is_valid_solicitud_valor(campo text, valor text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case campo
    when 'hijos' then public.is_valid_hijos_json(valor)
    when 'fecha_nacimiento' then
      valor is null
      or (valor ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and pg_catalog.pg_input_is_valid(valor, 'date'))
    when 'estado_civil' then
      valor is null or pg_catalog.pg_input_is_valid(valor, 'public.estado_civil')
    when 'tiene_hijos' then valor is null or valor in ('true', 'false')
    else true
  end;
$$;

-- Check constraints run these as the inserting user.
revoke execute on function public.campos_solicitud_permitidos() from public, anon;
revoke execute on function public.is_valid_hijos_json(text) from public, anon;
revoke execute on function public.is_valid_solicitud_valor(text, text) from public, anon;
grant execute on function public.campos_solicitud_permitidos() to authenticated;
grant execute on function public.is_valid_hijos_json(text) to authenticated;
grant execute on function public.is_valid_solicitud_valor(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Change requests: one row per submission by an Empleado
-- ---------------------------------------------------------------------------
create table public.solicitudes_cambio (
  id uuid primary key default gen_random_uuid(),
  legajo_id uuid not null references public.legajos (id) on delete cascade,
  -- Deferred, as legajo_documentos.uploaded_by: deleting a profile cascades
  -- through its legajo and removes its requests before this is checked.
  solicitado_por uuid not null default auth.uid()
    references public.profiles (id) deferrable initially deferred,
  estado public.solicitud_estado not null default 'pendiente',
  motivo_rechazo text,
  revisado_por uuid references public.profiles (id) deferrable initially deferred,
  revisado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A reason, with at least one non-whitespace character, exactly when rejected.
  constraint solicitudes_cambio_motivo_rechazo
    check (
      (estado = 'rechazada' and motivo_rechazo is not null and motivo_rechazo ~ '[^[:space:]]')
      or (estado <> 'rechazada' and motivo_rechazo is null)
    ),

  -- Reviewer and review time, together, exactly for decided requests.
  constraint solicitudes_cambio_revision
    check (
      (estado in ('aprobada', 'rechazada') and revisado_por is not null and revisado_en is not null)
      or (estado in ('pendiente', 'cancelada') and revisado_por is null and revisado_en is null)
    )
);

-- Only one pending request per legajo at a time.
create unique index solicitudes_cambio_una_pendiente_por_legajo
  on public.solicitudes_cambio (legajo_id)
  where estado = 'pendiente';

create index solicitudes_cambio_legajo_id_idx on public.solicitudes_cambio (legajo_id);
create index solicitudes_cambio_solicitado_por_idx on public.solicitudes_cambio (solicitado_por);
create index solicitudes_cambio_revisado_por_idx on public.solicitudes_cambio (revisado_por);

alter table public.solicitudes_cambio enable row level security;

create trigger solicitudes_cambio_set_updated_at
  before update on public.solicitudes_cambio
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Change request items: one proposed value per field
-- ---------------------------------------------------------------------------
-- valor_propuesto null means "clear the field". For 'hijos' it is the JSON
-- children set ('[]' clears it). valor_anterior is filled by a trigger from
-- the legajo at submission time; any value sent by the client is replaced.
create table public.solicitudes_cambio_items (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.solicitudes_cambio (id) on delete cascade,
  campo text not null,
  valor_propuesto text,
  valor_anterior text,
  created_at timestamptz not null default now(),

  constraint solicitudes_cambio_items_solicitud_campo_key unique (solicitud_id, campo),

  constraint solicitudes_cambio_items_campo_permitido
    check (campo = any (public.campos_solicitud_permitidos())),

  constraint solicitudes_cambio_items_valor_valido
    check (public.is_valid_solicitud_valor(campo, valor_propuesto))
);

alter table public.solicitudes_cambio_items enable row level security;

-- Reads under the caller's RLS: the Empleado only reaches their own request
-- and legajo. The value is read as text in the same format the application
-- uses (dates YYYY-MM-DD, booleans true/false, children as a JSON array).
create function public.set_solicitud_item_valor_anterior()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_legajo uuid;
begin
  select s.legajo_id into target_legajo
  from public.solicitudes_cambio as s
  where s.id = new.solicitud_id;

  if new.campo = 'hijos' then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'nombre_completo', h.nombre_completo,
          'fecha_nacimiento', h.fecha_nacimiento
        )
        order by h.fecha_nacimiento, h.nombre_completo
      ),
      '[]'::jsonb
    )::text
    into new.valor_anterior
    from public.legajo_hijos as h
    where h.legajo_id = target_legajo;
  else
    select pg_catalog.to_jsonb(l) ->> new.campo
    into new.valor_anterior
    from public.legajos as l
    where l.id = target_legajo;
  end if;

  return new;
end;
$$;

revoke execute on function public.set_solicitud_item_valor_anterior() from public, anon, authenticated;

create trigger solicitudes_cambio_items_set_valor_anterior
  before insert on public.solicitudes_cambio_items
  for each row
  execute function public.set_solicitud_item_valor_anterior();

-- ---------------------------------------------------------------------------
-- Grants: change requests
-- ---------------------------------------------------------------------------
-- anon: none. authenticated: RLS decides the rows. The review columns are
-- never writable through the API; decisions go through the functions below.
-- No DELETE for anyone: history is kept.
revoke all on table public.solicitudes_cambio from anon, authenticated;
revoke all on table public.solicitudes_cambio_items from anon, authenticated;

grant select on table public.solicitudes_cambio to authenticated;
grant insert (legajo_id, solicitado_por, estado) on table public.solicitudes_cambio to authenticated;
grant update (estado) on table public.solicitudes_cambio to authenticated;

grant select on table public.solicitudes_cambio_items to authenticated;
grant insert (solicitud_id, campo, valor_propuesto, valor_anterior)
  on table public.solicitudes_cambio_items to authenticated;

-- ---------------------------------------------------------------------------
-- Policies: solicitudes_cambio
-- ---------------------------------------------------------------------------
create policy solicitudes_cambio_select_own_or_admin
  on public.solicitudes_cambio
  for select
  to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.legajos as l
      where l.id = legajo_id and l.profile_id = (select auth.uid())
    )
  );

-- A new request is always pending, submitted by the caller, for their own legajo.
create policy solicitudes_cambio_insert_own
  on public.solicitudes_cambio
  for insert
  to authenticated
  with check (
    estado = 'pendiente'
    and solicitado_por = (select auth.uid())
    and exists (
      select 1 from public.legajos as l
      where l.id = legajo_id and l.profile_id = (select auth.uid())
    )
  );

-- The only direct update: the requester cancels their own pending request.
-- There is no update policy for Admin decisions (see aprobar_solicitud and
-- rechazar_solicitud), so estado cannot be flipped by hand.
create policy solicitudes_cambio_cancel_own
  on public.solicitudes_cambio
  for update
  to authenticated
  using (estado = 'pendiente' and solicitado_por = (select auth.uid()))
  with check (estado = 'cancelada' and solicitado_por = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Policies: solicitudes_cambio_items
-- ---------------------------------------------------------------------------
create policy solicitudes_cambio_items_select_own_or_admin
  on public.solicitudes_cambio_items
  for select
  to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1
      from public.solicitudes_cambio as s
      join public.legajos as l on l.id = s.legajo_id
      where s.id = solicitud_id and l.profile_id = (select auth.uid())
    )
  );

-- Items go only into the caller's own pending request. The allowed fields are
-- enforced by the solicitudes_cambio_items_campo_permitido constraint.
create policy solicitudes_cambio_items_insert_own
  on public.solicitudes_cambio_items
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.solicitudes_cambio as s
      where s.id = solicitud_id
        and s.estado = 'pendiente'
        and s.solicitado_por = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- legajos and legajo_hijos: direct writes are Admin only from now on
-- ---------------------------------------------------------------------------
-- Empleado changes flow through change requests. The column grants stay as
-- they are because Admin uses them; the policies decide who reaches a row.
-- The group E trigger (legajos_protect_laboral) stays for defence in depth.
drop policy legajos_update_own_or_admin on public.legajos;

create policy legajos_update_admin
  on public.legajos
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- The children set is part of group C and is approved as one field ('hijos').
drop policy legajo_hijos_insert_own_or_admin on public.legajo_hijos;
drop policy legajo_hijos_update_own_or_admin on public.legajo_hijos;
drop policy legajo_hijos_delete_own_or_admin on public.legajo_hijos;

create policy legajo_hijos_insert_admin
  on public.legajo_hijos
  for insert
  to authenticated
  with check ((select public.is_admin()));

create policy legajo_hijos_update_admin
  on public.legajo_hijos
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy legajo_hijos_delete_admin
  on public.legajo_hijos
  for delete
  to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- legajo_documentos: review state
-- ---------------------------------------------------------------------------
alter table public.legajo_documentos
  add column estado public.documento_estado not null default 'aprobado',
  add column motivo_rechazo text,
  add column revisado_por uuid references public.profiles (id) deferrable initially deferred,
  add column revisado_en timestamptz;

-- Documents that existed before this migration were current, so they are
-- approved. There was no reviewer: the uploader and upload time stand in.
update public.legajo_documentos
set revisado_por = uploaded_by, revisado_en = created_at
where revisado_por is null;

alter table public.legajo_documentos
  alter column estado set default 'pendiente';

alter table public.legajo_documentos
  add constraint legajo_documentos_motivo_rechazo
    check (
      (estado = 'rechazado' and motivo_rechazo is not null and motivo_rechazo ~ '[^[:space:]]')
      or (estado <> 'rechazado' and motivo_rechazo is null)
    ),
  add constraint legajo_documentos_revision
    check (
      (estado = 'pendiente' and revisado_por is null and revisado_en is null)
      or (estado <> 'pendiente' and revisado_por is not null and revisado_en is not null)
    );

create index legajo_documentos_revisado_por_idx on public.legajo_documentos (revisado_por);

-- At most one approved and at most one pending document per legajo and type.
-- Rejected and replaced documents are history and not limited.
alter table public.legajo_documentos
  drop constraint legajo_documentos_legajo_tipo_key;

create unique index legajo_documentos_un_aprobado_por_tipo
  on public.legajo_documentos (legajo_id, tipo)
  where estado = 'aprobado';

create unique index legajo_documentos_un_pendiente_por_tipo
  on public.legajo_documentos (legajo_id, tipo)
  where estado = 'pendiente';

-- Initial state for API uploads: Admin uploads are approved by that Admin,
-- Empleado uploads are pending. estado and the review columns are not
-- insertable through the API, so this is the only way they are set on insert.
-- Direct database connections (seeds) and the service role keep their values.
create function public.set_documento_estado_inicial()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  jwt_role text := auth.jwt() ->> 'role';
begin
  if jwt_role is null or jwt_role = 'service_role' then
    return new;
  end if;

  if public.is_admin() then
    new.estado := 'aprobado';
    new.revisado_por := auth.uid();
    new.revisado_en := pg_catalog.now();
  else
    new.estado := 'pendiente';
    new.revisado_por := null;
    new.revisado_en := null;
  end if;
  new.motivo_rechazo := null;

  return new;
end;
$$;

revoke execute on function public.set_documento_estado_inicial() from public, anon, authenticated;

create trigger legajo_documentos_set_estado_inicial
  before insert on public.legajo_documentos
  for each row
  execute function public.set_documento_estado_inicial();

-- Policies. Insert: as before, plus the initial state. Update (replace in
-- place): Admin only; an Empleado submits a new pending document instead.
-- Delete: Admin any; Empleado own while pending.
drop policy legajo_documentos_insert_own_or_admin on public.legajo_documentos;
drop policy legajo_documentos_update_own_or_admin on public.legajo_documentos;
drop policy legajo_documentos_delete_own_or_admin on public.legajo_documentos;

create policy legajo_documentos_insert_own_or_admin
  on public.legajo_documentos
  for insert
  to authenticated
  with check (
    uploaded_by = (select auth.uid())
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

create policy legajo_documentos_update_admin
  on public.legajo_documentos
  for update
  to authenticated
  using ((select public.is_admin()))
  with check (
    (select public.is_admin())
    and uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.legajos as l
      where l.id = legajo_id
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
      estado = 'pendiente'
      and exists (
        select 1 from public.legajos as l
        where l.id = legajo_id and l.profile_id = (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Decisions (Admin only). SECURITY DEFINER: they write columns and rows that
-- the API roles cannot. Each runs in the caller's single transaction.
-- ---------------------------------------------------------------------------
-- Error codes: 42501 caller is not an admin; 22023 blank rejection reason;
-- P0002 not found; 55000 not pending.

-- Applies every item to the legajo. Each allowed field is assigned explicitly
-- with its column type; no SQL is built from item values.
create function public.aprobar_solicitud(p_solicitud_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  solicitud public.solicitudes_cambio%rowtype;
  valores jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can approve change requests' using errcode = '42501';
  end if;

  select * into solicitud
  from public.solicitudes_cambio
  where id = p_solicitud_id
  for update;

  if not found then
    raise exception 'Change request not found' using errcode = 'P0002';
  end if;
  if solicitud.estado <> 'pendiente' then
    raise exception 'Change request is not pending' using errcode = '55000';
  end if;

  select coalesce(pg_catalog.jsonb_object_agg(i.campo, i.valor_propuesto), '{}'::jsonb)
  into valores
  from public.solicitudes_cambio_items as i
  where i.solicitud_id = p_solicitud_id and i.campo <> 'hijos';

  if valores <> '{}'::jsonb then
    update public.legajos as l
    set
      nombres = case when valores ? 'nombres' then valores ->> 'nombres' else l.nombres end,
      apellido = case when valores ? 'apellido' then valores ->> 'apellido' else l.apellido end,
      dni = case when valores ? 'dni' then valores ->> 'dni' else l.dni end,
      nacionalidad = case when valores ? 'nacionalidad' then valores ->> 'nacionalidad' else l.nacionalidad end,
      cuil = case when valores ? 'cuil' then valores ->> 'cuil' else l.cuil end,
      fecha_nacimiento = case when valores ? 'fecha_nacimiento'
        then (valores ->> 'fecha_nacimiento')::date else l.fecha_nacimiento end,
      calle_altura = case when valores ? 'calle_altura' then valores ->> 'calle_altura' else l.calle_altura end,
      piso_depto = case when valores ? 'piso_depto' then valores ->> 'piso_depto' else l.piso_depto end,
      localidad = case when valores ? 'localidad' then valores ->> 'localidad' else l.localidad end,
      partido = case when valores ? 'partido' then valores ->> 'partido' else l.partido end,
      partido_otro = case when valores ? 'partido_otro' then valores ->> 'partido_otro' else l.partido_otro end,
      telefono_celular = case when valores ? 'telefono_celular'
        then valores ->> 'telefono_celular' else l.telefono_celular end,
      email_personal = case when valores ? 'email_personal'
        then valores ->> 'email_personal' else l.email_personal end,
      estado_civil = case when valores ? 'estado_civil'
        then (valores ->> 'estado_civil')::public.estado_civil else l.estado_civil end,
      nombre_conyuge = case when valores ? 'nombre_conyuge'
        then valores ->> 'nombre_conyuge' else l.nombre_conyuge end,
      tiene_hijos = case when valores ? 'tiene_hijos'
        then (valores ->> 'tiene_hijos')::boolean else l.tiene_hijos end,
      grupo_sanguineo = case when valores ? 'grupo_sanguineo'
        then valores ->> 'grupo_sanguineo' else l.grupo_sanguineo end,
      alergias = case when valores ? 'alergias' then valores ->> 'alergias' else l.alergias end,
      medicacion_habitual = case when valores ? 'medicacion_habitual'
        then valores ->> 'medicacion_habitual' else l.medicacion_habitual end,
      obra_social = case when valores ? 'obra_social' then valores ->> 'obra_social' else l.obra_social end,
      numero_afiliado = case when valores ? 'numero_afiliado'
        then valores ->> 'numero_afiliado' else l.numero_afiliado end,
      emergencia_nombre = case when valores ? 'emergencia_nombre'
        then valores ->> 'emergencia_nombre' else l.emergencia_nombre end,
      emergencia_parentesco = case when valores ? 'emergencia_parentesco'
        then valores ->> 'emergencia_parentesco' else l.emergencia_parentesco end,
      emergencia_domicilio = case when valores ? 'emergencia_domicilio'
        then valores ->> 'emergencia_domicilio' else l.emergencia_domicilio end,
      emergencia_telefono = case when valores ? 'emergencia_telefono'
        then valores ->> 'emergencia_telefono' else l.emergencia_telefono end
    where l.id = solicitud.legajo_id;
  end if;

  -- The children set is replaced as a whole.
  if exists (
    select 1 from public.solicitudes_cambio_items as i
    where i.solicitud_id = p_solicitud_id and i.campo = 'hijos'
  ) then
    delete from public.legajo_hijos as h where h.legajo_id = solicitud.legajo_id;

    insert into public.legajo_hijos (legajo_id, nombre_completo, fecha_nacimiento)
    select solicitud.legajo_id, h.nombre_completo, h.fecha_nacimiento
    from public.solicitudes_cambio_items as i
    cross join lateral pg_catalog.jsonb_to_recordset(i.valor_propuesto::jsonb)
      as h (nombre_completo text, fecha_nacimiento date)
    where i.solicitud_id = p_solicitud_id and i.campo = 'hijos';
  end if;

  update public.solicitudes_cambio
  set estado = 'aprobada', revisado_por = auth.uid(), revisado_en = pg_catalog.now()
  where id = p_solicitud_id;
end;
$$;

create function public.rechazar_solicitud(p_solicitud_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  solicitud public.solicitudes_cambio%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reject change requests' using errcode = '42501';
  end if;
  if p_motivo is null or p_motivo !~ '[^[:space:]]' then
    raise exception 'A rejection reason is required' using errcode = '22023';
  end if;

  select * into solicitud
  from public.solicitudes_cambio
  where id = p_solicitud_id
  for update;

  if not found then
    raise exception 'Change request not found' using errcode = 'P0002';
  end if;
  if solicitud.estado <> 'pendiente' then
    raise exception 'Change request is not pending' using errcode = '55000';
  end if;

  update public.solicitudes_cambio
  set
    estado = 'rechazada',
    motivo_rechazo = pg_catalog.btrim(p_motivo),
    revisado_por = auth.uid(),
    revisado_en = pg_catalog.now()
  where id = p_solicitud_id;
end;
$$;

-- The approved document of the same type, if any, becomes 'reemplazado'.
create function public.aprobar_documento(p_documento_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  documento public.legajo_documentos%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can approve documents' using errcode = '42501';
  end if;

  select * into documento
  from public.legajo_documentos
  where id = p_documento_id
  for update;

  if not found then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  if documento.estado <> 'pendiente' then
    raise exception 'Document is not pending' using errcode = '55000';
  end if;

  -- First, so the one-approved-per-type index holds at every step.
  update public.legajo_documentos
  set estado = 'reemplazado'
  where legajo_id = documento.legajo_id
    and tipo = documento.tipo
    and estado = 'aprobado';

  update public.legajo_documentos
  set estado = 'aprobado', revisado_por = auth.uid(), revisado_en = pg_catalog.now()
  where id = p_documento_id;
end;
$$;

create function public.rechazar_documento(p_documento_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  documento public.legajo_documentos%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reject documents' using errcode = '42501';
  end if;
  if p_motivo is null or p_motivo !~ '[^[:space:]]' then
    raise exception 'A rejection reason is required' using errcode = '22023';
  end if;

  select * into documento
  from public.legajo_documentos
  where id = p_documento_id
  for update;

  if not found then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  if documento.estado <> 'pendiente' then
    raise exception 'Document is not pending' using errcode = '55000';
  end if;

  update public.legajo_documentos
  set
    estado = 'rechazado',
    motivo_rechazo = pg_catalog.btrim(p_motivo),
    revisado_por = auth.uid(),
    revisado_en = pg_catalog.now()
  where id = p_documento_id;
end;
$$;

-- Pending counts for the Admin indicator (one row).
create function public.pendientes_admin()
returns table (solicitudes bigint, documentos bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can read pending counts' using errcode = '42501';
  end if;

  return query
  select
    (select pg_catalog.count(*) from public.solicitudes_cambio as s where s.estado = 'pendiente'),
    (select pg_catalog.count(*) from public.legajo_documentos as d where d.estado = 'pendiente');
end;
$$;

revoke execute on function public.aprobar_solicitud(uuid) from public, anon;
revoke execute on function public.rechazar_solicitud(uuid, text) from public, anon;
revoke execute on function public.aprobar_documento(uuid) from public, anon;
revoke execute on function public.rechazar_documento(uuid, text) from public, anon;
revoke execute on function public.pendientes_admin() from public, anon;
grant execute on function public.aprobar_solicitud(uuid) to authenticated;
grant execute on function public.rechazar_solicitud(uuid, text) to authenticated;
grant execute on function public.aprobar_documento(uuid) to authenticated;
grant execute on function public.rechazar_documento(uuid, text) to authenticated;
grant execute on function public.pendientes_admin() to authenticated;
