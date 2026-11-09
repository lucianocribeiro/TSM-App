-- F2-05: Mis Recibos (PRD Fase 2 v0.8 RF-13 to RF-18, §5; Constitution
-- §11). The employee's two write functions: register a signature version
-- and sign an own pending receipt in a visible period.
--
-- Both are SECURITY DEFINER with search_path '' and check, first, that the
-- caller is an active Empleado (42501 otherwise). Typed refusals carry a HINT
-- that the Server Actions map to es-AR copy:
--   recibo_ajeno        no such receipt of the caller (another employee's
--                       receipt gets the same answer as a missing one)
--   periodo_no_visible  the receipt's period is a draft
--   recibo_ya_firmado   the receipt is already signed
--   sin_firma           the caller has no active signature
--   hora_invalida       the signing time is not within the last 2 minutes
--                       of the database clock (5 seconds of clock skew
--                       allowed ahead)
--   archivo_repetido    the signed file is the current file itself
-- Path ownership (owner, and period for receipts) is the F2-03 CHECK
-- (23514); one row per stored path is the F2-04 unique index (23505).
-- No storage object is deleted here: recibo_firmar returns the previous
-- (unsigned) path for the Server Action to remove after commit, or null when
-- another row (history or an override) still holds it.

-- ---------------------------------------------------------------------------
-- Register a signature version
-- ---------------------------------------------------------------------------
-- The caller's next version becomes the active one; the previous active
-- version is retired and kept as evidence (firmas_empleado_proteger allows
-- only that change). Returns the new version number.
create function public.firma_registrar(p_imagen_path text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  if not (public.current_app_role() = 'empleado'::public.app_role and public.cuenta_activa()) then
    raise exception 'Only an active employee can register a signature' using errcode = '42501';
  end if;

  -- Every version of the caller, locked: concurrent registrations queue.
  perform 1
  from public.firmas_empleado as f
  where f.empleado_id = auth.uid()
  for update;

  select coalesce(max(f.version), 0) + 1 into v_version
  from public.firmas_empleado as f
  where f.empleado_id = auth.uid();

  update public.firmas_empleado
  set activa = false
  where empleado_id = auth.uid()
    and activa;

  insert into public.firmas_empleado (empleado_id, version, imagen_path, activa)
  values (auth.uid(), v_version, p_imagen_path, true);

  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sign an own pending receipt
-- ---------------------------------------------------------------------------
-- p_archivo_path: the stamped PDF, already stored at a new path of the same
-- employee and period. p_firmado_at: the time the Server Action stamped on
-- the PDF, taken once on the server; accepted only within the last 2 minutes
-- of the database clock, so the file and the evidence always agree.
create function public.recibo_firmar(
  p_recibo_id uuid,
  p_archivo_path text,
  p_archivo_bytes integer,
  p_firmado_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recibo public.recibos%rowtype;
  v_periodo_estado public.recibo_periodo_estado;
  v_firma_id uuid;
begin
  if not (public.current_app_role() = 'empleado'::public.app_role and public.cuenta_activa()) then
    raise exception 'Only an active employee can sign a receipt' using errcode = '42501';
  end if;

  select * into v_recibo
  from public.recibos as r
  where r.id = p_recibo_id
    and r.empleado_id = auth.uid()
  for update;
  if not found then
    -- The same answer for a missing receipt and another employee's.
    raise exception 'Receipt not found' using errcode = 'P0002', hint = 'recibo_ajeno';
  end if;

  select p.estado into v_periodo_estado
  from public.recibo_periodos as p
  where p.id = v_recibo.periodo_id;
  if v_periodo_estado = 'borrador'::public.recibo_periodo_estado then
    -- Employees see nothing of a draft: the same answer as a missing receipt.
    raise exception 'Receipt not found' using errcode = 'P0002', hint = 'periodo_no_visible';
  end if;

  if v_recibo.estado <> 'pendiente'::public.recibo_estado then
    raise exception 'The receipt is already signed' using errcode = '55000', hint = 'recibo_ya_firmado';
  end if;

  select f.id into v_firma_id
  from public.firmas_empleado as f
  where f.empleado_id = auth.uid()
    and f.activa;
  if not found then
    raise exception 'No active signature' using errcode = '55000', hint = 'sin_firma';
  end if;

  if p_firmado_at is null
    or p_firmado_at < pg_catalog.now() - interval '2 minutes'
    or p_firmado_at > pg_catalog.now() + interval '5 seconds'
  then
    raise exception 'Signing time out of range' using errcode = '22023', hint = 'hora_invalida';
  end if;

  if p_archivo_path = v_recibo.archivo_path then
    raise exception 'The signed file is the current file' using errcode = '22023', hint = 'archivo_repetido';
  end if;

  update public.recibos
  set archivo_path = p_archivo_path,
      archivo_bytes = p_archivo_bytes,
      estado = 'firmado'::public.recibo_estado,
      firmado_at = p_firmado_at,
      firma_id = v_firma_id
  where id = v_recibo.id;

  insert into public.recibo_firmas (recibo_id, empleado_id, firma_id, firmado_at)
  values (v_recibo.id, auth.uid(), v_firma_id, p_firmado_at);

  -- The unsigned file, unless a history row or an override still holds it.
  if exists (select 1 from public.recibo_historial as h where h.archivo_path = v_recibo.archivo_path)
    or exists (select 1 from public.recibo_overrides as o where o.archivo_path = v_recibo.archivo_path)
  then
    return null;
  end if;
  return v_recibo.archivo_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.firma_registrar(text) from public, anon;
revoke execute on function public.recibo_firmar(uuid, text, integer, timestamptz) from public, anon;

grant execute on function public.firma_registrar(text) to authenticated;
grant execute on function public.recibo_firmar(uuid, text, integer, timestamptz) to authenticated;
