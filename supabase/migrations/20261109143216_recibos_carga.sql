-- F2-04: Carga de recibos (PRD Fase 2 v0.7 RF-01 to RF-12, Constitution
-- §11). Indexes on the stored paths, the replacement rule of the signed
-- receipt guard, and the Admin write functions: periods (create, publish,
-- close, re-open) and receipt registration (new, replacement, override).
--
-- Every function is SECURITY DEFINER with search_path '' and checks, first,
-- that the caller is an active Admin (42501 otherwise). Typed refusals carry
-- a HINT that the Server Actions map to es-AR copy:
--   periodo_invalido      year or month out of range
--   periodo_existente     a period for that month already exists
--   periodo_inexistente   no such period
--   transicion_invalida   the period is not in the state the change starts from
--   periodo_cerrado       the period is closed: no upload or replacement
--   empleado_no_elegible  not an active Empleado account
--   requiere_reemplazo    the employee already has a receipt in the period
--                         (DETAIL: firmado or pendiente)
--   archivo_repetido      the replacement is the current file itself
--   conflicto_concurrente another upload for the same receipt won the race
-- No storage object is ever deleted here: replaced files stay in storage,
-- referenced by the history.

-- ---------------------------------------------------------------------------
-- Indexes on stored paths
-- ---------------------------------------------------------------------------
-- One row per object, and fast lookups for the storage policy EXISTS and the
-- orphan sweep.
create unique index recibos_archivo_path_key on public.recibos (archivo_path);
create unique index firmas_empleado_imagen_path_key on public.firmas_empleado (imagen_path);
create index recibo_historial_archivo_path_idx on public.recibo_historial (archivo_path);
create index recibo_overrides_archivo_path_idx on public.recibo_overrides (archivo_path);

-- ---------------------------------------------------------------------------
-- Signed receipt guard: the replacement path
-- ---------------------------------------------------------------------------
-- A signed receipt goes back to pending only when, in the same transaction,
-- its current file was copied to the history (recibo_registrar). Anything
-- else, the service role included, is still refused. The recibos_firmado
-- CHECK makes the same update clear firmado_at and firma_id.
create or replace function public.recibos_proteger_firmado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado = 'firmado'::public.recibo_estado
    and new.estado = 'pendiente'::public.recibo_estado
    and not exists (
      select 1
      from public.recibo_historial as h
      where h.recibo_id = old.id
        and h.archivo_path = old.archivo_path
        and h.reemplazado_at = pg_catalog.now()
    )
  then
    raise exception 'A signed receipt cannot go back to pending'
      using errcode = '55000', hint = 'recibo_firmado';
  end if;
  return new;
end;
$$;

revoke execute on function public.recibos_proteger_firmado() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Periods
-- ---------------------------------------------------------------------------
create function public.recibo_periodo_crear(p_anio integer, p_mes integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (public.is_admin() and public.cuenta_activa()) then
    raise exception 'Only an active admin can manage receipt periods' using errcode = '42501';
  end if;
  if p_anio is null or p_mes is null or p_anio not between 2000 and 2100 or p_mes not between 1 and 12 then
    raise exception 'Year or month out of range'
      using errcode = '22023', hint = 'periodo_invalido';
  end if;

  begin
    insert into public.recibo_periodos (anio, mes, estado, created_by)
    values (p_anio, p_mes, 'borrador'::public.recibo_periodo_estado, auth.uid())
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'A period for that month already exists'
        using errcode = '23505', hint = 'periodo_existente';
  end;

  insert into public.recibo_periodo_historial (periodo_id, accion, actor_id)
  values (v_id, 'creado'::public.recibo_periodo_accion, auth.uid());
  return v_id;
end;
$$;

-- The period's state, locked for the change, or a typed refusal.
create function public.recibo_periodo_publicar(p_periodo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado public.recibo_periodo_estado;
begin
  if not (public.is_admin() and public.cuenta_activa()) then
    raise exception 'Only an active admin can manage receipt periods' using errcode = '42501';
  end if;

  select p.estado into v_estado
  from public.recibo_periodos as p
  where p.id = p_periodo_id
  for update;
  if not found then
    raise exception 'Period not found' using errcode = 'P0002', hint = 'periodo_inexistente';
  end if;
  if v_estado <> 'borrador'::public.recibo_periodo_estado then
    raise exception 'Only a draft period can be published'
      using errcode = '55000', hint = 'transicion_invalida';
  end if;

  update public.recibo_periodos
  set estado = 'publicado'::public.recibo_periodo_estado,
      publicado_at = pg_catalog.now(),
      publicado_por = auth.uid()
  where id = p_periodo_id;

  insert into public.recibo_periodo_historial (periodo_id, accion, actor_id)
  values (p_periodo_id, 'publicado'::public.recibo_periodo_accion, auth.uid());
end;
$$;

create function public.recibo_periodo_cerrar(p_periodo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado public.recibo_periodo_estado;
begin
  if not (public.is_admin() and public.cuenta_activa()) then
    raise exception 'Only an active admin can manage receipt periods' using errcode = '42501';
  end if;

  select p.estado into v_estado
  from public.recibo_periodos as p
  where p.id = p_periodo_id
  for update;
  if not found then
    raise exception 'Period not found' using errcode = 'P0002', hint = 'periodo_inexistente';
  end if;
  if v_estado <> 'publicado'::public.recibo_periodo_estado then
    raise exception 'Only a published period can be closed'
      using errcode = '55000', hint = 'transicion_invalida';
  end if;

  update public.recibo_periodos
  set estado = 'cerrado'::public.recibo_periodo_estado,
      cerrado_at = pg_catalog.now(),
      cerrado_por = auth.uid()
  where id = p_periodo_id;

  insert into public.recibo_periodo_historial (periodo_id, accion, actor_id)
  values (p_periodo_id, 'cerrado'::public.recibo_periodo_accion, auth.uid());
end;
$$;

create function public.recibo_periodo_reabrir(p_periodo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado public.recibo_periodo_estado;
begin
  if not (public.is_admin() and public.cuenta_activa()) then
    raise exception 'Only an active admin can manage receipt periods' using errcode = '42501';
  end if;

  select p.estado into v_estado
  from public.recibo_periodos as p
  where p.id = p_periodo_id
  for update;
  if not found then
    raise exception 'Period not found' using errcode = 'P0002', hint = 'periodo_inexistente';
  end if;
  if v_estado <> 'cerrado'::public.recibo_periodo_estado then
    raise exception 'Only a closed period can be re-opened'
      using errcode = '55000', hint = 'transicion_invalida';
  end if;

  -- Back to published: publicado_at and publicado_por stay as they were.
  update public.recibo_periodos
  set estado = 'publicado'::public.recibo_periodo_estado,
      cerrado_at = null,
      cerrado_por = null
  where id = p_periodo_id;

  insert into public.recibo_periodo_historial (periodo_id, accion, actor_id)
  values (p_periodo_id, 'reabierto'::public.recibo_periodo_accion, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Receipt registration
-- ---------------------------------------------------------------------------
-- The uploaded file (already in storage, checked by the Server Action:
-- owner and period folder, PDF bytes, DNI) becomes the employee's receipt
-- in the period: a new pendiente receipt, or, with p_reemplazar, the current
-- one is copied to the history as it was and reset to pendiente with the
-- new file. p_override_motivo: the Admin accepted a failed or impossible DNI
-- check; the override records it with the new file.
create function public.recibo_registrar(
  p_periodo_id uuid,
  p_empleado_id uuid,
  p_archivo_path text,
  p_archivo_bytes integer,
  p_reemplazar boolean,
  p_override_motivo public.recibo_override_motivo default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_periodo_estado public.recibo_periodo_estado;
  v_actual public.recibos%rowtype;
  v_id uuid;
begin
  if not (public.is_admin() and public.cuenta_activa()) then
    raise exception 'Only an active admin can register receipts' using errcode = '42501';
  end if;

  -- Shared lock: no state change of the period while the receipt is written.
  select p.estado into v_periodo_estado
  from public.recibo_periodos as p
  where p.id = p_periodo_id
  for share;
  if not found then
    raise exception 'Period not found' using errcode = 'P0002', hint = 'periodo_inexistente';
  end if;
  if v_periodo_estado = 'cerrado'::public.recibo_periodo_estado then
    raise exception 'The period is closed' using errcode = '55000', hint = 'periodo_cerrado';
  end if;

  if not exists (
    select 1
    from public.profiles as e
    where e.id = p_empleado_id
      and e.role = 'empleado'::public.app_role
      and e.estado_cuenta = 'activa'::public.cuenta_estado
  ) then
    raise exception 'Not an active employee account' using errcode = '55000', hint = 'empleado_no_elegible';
  end if;

  select * into v_actual
  from public.recibos as r
  where r.periodo_id = p_periodo_id
    and r.empleado_id = p_empleado_id
  for update;

  if not found then
    begin
      insert into public.recibos (periodo_id, empleado_id, archivo_path, archivo_bytes, cargado_por)
      values (p_periodo_id, p_empleado_id, p_archivo_path, p_archivo_bytes, auth.uid())
      returning id into v_id;
    exception
      when unique_violation then
        raise exception 'Another upload registered this receipt first'
          using errcode = '40001', hint = 'conflicto_concurrente';
    end;
  elsif not coalesce(p_reemplazar, false) then
    raise exception 'The employee already has a receipt in this period'
      using errcode = '55000',
            hint = 'requiere_reemplazo',
            detail = v_actual.estado::text;
  elsif v_actual.archivo_path = p_archivo_path then
    raise exception 'The replacement is the current file'
      using errcode = '22023', hint = 'archivo_repetido';
  else
    -- The current receipt, exactly as it is, and only then the reset (the
    -- signed receipt guard looks for this history row).
    insert into public.recibo_historial (
      recibo_id, periodo_id, empleado_id, archivo_path, archivo_bytes, estado_al_reemplazo,
      firmado_at, firma_id, cargado_por, cargado_at, reemplazado_por, reemplazado_at
    )
    values (
      v_actual.id, v_actual.periodo_id, v_actual.empleado_id, v_actual.archivo_path, v_actual.archivo_bytes,
      v_actual.estado, v_actual.firmado_at, v_actual.firma_id, v_actual.cargado_por, v_actual.cargado_at,
      auth.uid(), pg_catalog.now()
    );

    update public.recibos
    set archivo_path = p_archivo_path,
        archivo_bytes = p_archivo_bytes,
        estado = 'pendiente'::public.recibo_estado,
        firmado_at = null,
        firma_id = null,
        cargado_por = auth.uid(),
        cargado_at = pg_catalog.now()
    where id = v_actual.id;
    v_id := v_actual.id;
  end if;

  if p_override_motivo is not null then
    insert into public.recibo_overrides (recibo_id, motivo, archivo_path, admin_id)
    values (v_id, p_override_motivo, p_archivo_path, auth.uid());
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.recibo_periodo_crear(integer, integer) from public, anon;
revoke execute on function public.recibo_periodo_publicar(uuid) from public, anon;
revoke execute on function public.recibo_periodo_cerrar(uuid) from public, anon;
revoke execute on function public.recibo_periodo_reabrir(uuid) from public, anon;
revoke execute on function public.recibo_registrar(uuid, uuid, text, integer, boolean, public.recibo_override_motivo) from public, anon;

grant execute on function public.recibo_periodo_crear(integer, integer) to authenticated;
grant execute on function public.recibo_periodo_publicar(uuid) to authenticated;
grant execute on function public.recibo_periodo_cerrar(uuid) to authenticated;
grant execute on function public.recibo_periodo_reabrir(uuid) to authenticated;
grant execute on function public.recibo_registrar(uuid, uuid, text, integer, boolean, public.recibo_override_motivo) to authenticated;
