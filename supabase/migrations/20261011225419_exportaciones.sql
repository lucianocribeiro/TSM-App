-- CR-4: the export log. Every Excel export of the Legajos list is recorded:
-- who, when, which fields, whether the children were included, how many
-- employees, the list's filters and the result. Written only through
-- registrar_exportacion, by the export action in the request that builds the
-- file (no log row, no file). Read by an active Admin only. Nothing can
-- change or delete a row through the API.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table public.exportaciones (
  id uuid primary key default gen_random_uuid(),
  -- Newest first, also for two exports in the same instant.
  secuencia bigint generated always as identity,
  -- Deferred, as in cuenta_eventos. An Admin named here cannot be purged
  -- (purgar_cuenta, below), as in the Configuración history.
  actor_id uuid not null references public.profiles (id) deferrable initially deferred,
  created_at timestamptz not null default now(),
  -- The exported field keys, in the file's column order (allow-listed by the
  -- app; checked for shape here).
  campos text[] not null,
  incluye_hijos boolean not null,
  -- Employees exported (rows of the Legajos sheet).
  cantidad integer not null,
  -- The list state the export ran with: search text, estado laboral, Área,
  -- Sucursal and Tarea ids, and whether deactivated accounts were shown. The
  -- search text may hold personal data: never logged anywhere else.
  filtros jsonb not null,
  resultado text not null,

  constraint exportaciones_campos
    check (
      pg_catalog.cardinality(campos) between 1 and 100
      and pg_catalog.array_position(campos, null) is null
    ),
  constraint exportaciones_cantidad check (cantidad >= 0),
  constraint exportaciones_filtros check (pg_catalog.jsonb_typeof(filtros) = 'object'),
  constraint exportaciones_resultado check (resultado in ('ok', 'error'))
);

create index exportaciones_secuencia_idx on public.exportaciones (secuencia desc);
create index exportaciones_actor_id_idx on public.exportaciones (actor_id);

alter table public.exportaciones enable row level security;

-- SELECT for an active Admin. INSERT, UPDATE, DELETE: no grant and no policy
-- for any API role; registrar_exportacion writes.
revoke all on table public.exportaciones from anon, authenticated;
grant select on table public.exportaciones to authenticated;

create policy exportaciones_select_admin
  on public.exportaciones
  for select
  to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Write path
-- ---------------------------------------------------------------------------
-- Records one export by the calling Admin and returns its id. SECURITY
-- DEFINER: it writes a row the API roles cannot; the actor and the time come
-- from the session and the clock, never from the caller.
-- Error codes: 42501 caller is not an active Admin; 22023 malformed input
-- (no fields, an empty or repeated field, a negative count, filters that are
-- not an object, a result other than ok or error).
create function public.registrar_exportacion(
  p_campos text[],
  p_incluye_hijos boolean,
  p_cantidad integer,
  p_filtros jsonb,
  p_resultado text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  nueva uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can export' using errcode = '42501';
  end if;
  if p_campos is null
    or pg_catalog.cardinality(p_campos) = 0
    or pg_catalog.array_position(p_campos, null) is not null
    or exists (select 1 from pg_catalog.unnest(p_campos) as c(campo) where c.campo !~ '^[a-z_]{1,40}$')
    or (select pg_catalog.count(distinct c.campo) from pg_catalog.unnest(p_campos) as c(campo)) <> pg_catalog.cardinality(p_campos)
  then
    raise exception 'The exported fields are malformed' using errcode = '22023';
  end if;
  if p_incluye_hijos is null or p_cantidad is null or p_cantidad < 0
    or p_filtros is null or pg_catalog.jsonb_typeof(p_filtros) <> 'object'
    or p_resultado is null or p_resultado not in ('ok', 'error')
  then
    raise exception 'The export record is malformed' using errcode = '22023';
  end if;

  insert into public.exportaciones (actor_id, campos, incluye_hijos, cantidad, filtros, resultado)
  values (auth.uid(), p_campos, p_incluye_hijos, p_cantidad, p_filtros, p_resultado)
  returning id into nueva;
  return nueva;
end;
$$;

revoke execute on function public.registrar_exportacion(text[], boolean, integer, jsonb, text) from public, anon;
grant execute on function public.registrar_exportacion(text[], boolean, integer, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Purge: an Admin named in the export log stays
-- ---------------------------------------------------------------------------
-- As in CR-1, plus one more history that names the account: exportaciones
-- (its actor_id would otherwise block the delete with a foreign-key error
-- instead of the controlled refusal).
create or replace function public.purgar_cuenta(p_profile_id uuid, p_email_confirmacion text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cuenta public.profiles%rowtype;
  email_cuenta text;
  target_legajo uuid;
  admins_activos integer;
  resumen jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can purge accounts' using errcode = '42501';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'An account cannot be purged by itself'
      using errcode = '55000', hint = 'cuenta_propia';
  end if;

  perform 1
  from public.profiles as p
  where p.role = 'admin' and p.estado_cuenta = 'activa'
  order by p.id
  for update;

  -- The caller may have lost Admin rights, or been purged, while waiting.
  if not public.is_admin() then
    raise exception 'Only an admin can purge accounts' using errcode = '42501';
  end if;

  select * into cuenta from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  -- Exact match: no trimming, no case folding.
  select u.email into email_cuenta from auth.users as u where u.id = p_profile_id;
  if email_cuenta is null or email_cuenta is distinct from p_email_confirmacion then
    raise exception 'The confirmation email does not match'
      using errcode = '55000', hint = 'email_no_coincide';
  end if;

  if cuenta.role = 'admin' and cuenta.estado_cuenta = 'activa' then
    select pg_catalog.count(*) into admins_activos
    from public.profiles as p
    where p.role = 'admin' and p.estado_cuenta = 'activa';
    if admins_activos <= 1 then
      raise exception 'The last active admin cannot be purged'
        using errcode = '55000', hint = 'ultimo_admin';
    end if;
  end if;

  select l.id into target_legajo from public.legajos as l where l.profile_id = p_profile_id;

  -- Other accounts' history, the lists' history or the export log names this
  -- account: it must stay.
  if exists (
      select 1 from public.legajo_documentos as d
      where (d.uploaded_by = p_profile_id or d.revisado_por = p_profile_id)
        and d.legajo_id is distinct from target_legajo
    )
    or exists (
      select 1 from public.solicitudes_cambio as s
      where (s.revisado_por = p_profile_id or s.solicitado_por = p_profile_id)
        and s.legajo_id is distinct from target_legajo
    )
    or exists (
      select 1 from public.cuenta_eventos as e
      where e.actor_id = p_profile_id and e.profile_id <> p_profile_id
    )
    or exists (
      select 1 from public.catalogo_eventos as c
      where c.actor_id = p_profile_id
    )
    or exists (
      select 1 from public.exportaciones as x
      where x.actor_id = p_profile_id
    )
  then
    raise exception 'The account is named in other accounts'' history'
      using errcode = '55000', hint = 'historial_otras_cuentas';
  end if;

  resumen := pg_catalog.jsonb_build_object(
    'documentos', (select pg_catalog.count(*) from public.legajo_documentos as d where d.legajo_id = target_legajo),
    'hijos', (select pg_catalog.count(*) from public.legajo_hijos as h where h.legajo_id = target_legajo),
    'solicitudes', (select pg_catalog.count(*) from public.solicitudes_cambio as s where s.legajo_id = target_legajo),
    'eventos', (select pg_catalog.count(*) from public.cuenta_eventos as e where e.profile_id = p_profile_id)
  );

  delete from public.profiles where id = p_profile_id;

  return resumen;
end;
$$;
