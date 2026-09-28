-- F1-09B: approvals inbox support, DB-enforced pending-request lock, Admin
-- document replacement with a history option, replaced-history visibility
-- and the own-account rule on decisions (Constitution §9, PRD US-4, US-7).

-- ---------------------------------------------------------------------------
-- Who replaced a document, and when
-- ---------------------------------------------------------------------------
-- Filled when a document becomes 'reemplazado' (aprobar_documento and
-- reemplazar_documento below). Documents replaced before this migration have
-- no record of it and keep both null. Not in any column grant: written only by
-- the functions. If the replacing profile is purged, the name goes with it.
alter table public.legajo_documentos
  add column reemplazado_por uuid references public.profiles (id) on delete set null,
  add column reemplazado_en timestamptz;

alter table public.legajo_documentos
  add constraint legajo_documentos_reemplazo
    check (estado = 'reemplazado' or (reemplazado_por is null and reemplazado_en is null));

create index legajo_documentos_reemplazado_por_idx on public.legajo_documentos (reemplazado_por);

-- ---------------------------------------------------------------------------
-- Pending-request lock (replaces the app-only check of F1-09A)
-- ---------------------------------------------------------------------------
-- While a legajo has a pending change request, groups A to D (the allowed
-- request fields) and its children cannot change through the API. Group E
-- still can. Direct database connections (migrations, seeds) and the service
-- role (system jobs) are not API users and are not locked, as in
-- protect_legajo_laboral.
--
-- There is no bypass flag: aprobar_solicitud marks the request 'aprobada'
-- before it applies the values, so by the time it writes the legajo there is
-- no pending request and the lock does not apply. A client cannot reach that
-- state by hand: estado changes only through the decision functions, or when
-- the requester cancels their own request (solicitudes_cambio_cancel_own).
--
-- Race with a new request: crear_solicitud locks the legajo row (FOR NO KEY
-- UPDATE) before inserting, which waits for an Admin update of that row in
-- progress and blocks new ones; the children trigger takes FOR SHARE on the
-- parent legajo row, which conflicts with it too. Each check below runs with
-- a fresh snapshot after the lock, so it sees a request committed meanwhile.
create function public.hay_solicitud_pendiente(p_legajo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.solicitudes_cambio as s
    where s.legajo_id = p_legajo_id and s.estado = 'pendiente'
  );
$$;

-- Internal: only the triggers below call it.
revoke execute on function public.hay_solicitud_pendiente(uuid) from public, anon, authenticated;

create function public.bloquear_legajo_pendiente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_role text := auth.jwt() ->> 'role';
begin
  if jwt_role is null or jwt_role = 'service_role' then
    return new;
  end if;

  if exists (
      select 1
      from pg_catalog.unnest(public.campos_solicitud_permitidos()) as c (campo)
      where c.campo <> 'hijos'
        and (pg_catalog.to_jsonb(new) -> c.campo) is distinct from (pg_catalog.to_jsonb(old) -> c.campo)
    )
    and public.hay_solicitud_pendiente(new.id)
  then
    raise exception 'The legajo has a pending change request'
      using errcode = '55000', hint = 'solicitud_pendiente';
  end if;

  return new;
end;
$$;

revoke execute on function public.bloquear_legajo_pendiente() from public, anon, authenticated;

create trigger legajos_bloquear_pendiente
  before update on public.legajos
  for each row
  execute function public.bloquear_legajo_pendiente();

create function public.bloquear_hijos_pendiente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_role text := auth.jwt() ->> 'role';
  ids uuid[] := '{}';
  legajo uuid;
begin
  -- Every legajo the write touches: an update may move a child.
  if tg_op <> 'INSERT' then
    ids := ids || old.legajo_id;
  end if;
  if tg_op <> 'DELETE' then
    ids := ids || new.legajo_id;
  end if;

  if jwt_role is not null and jwt_role <> 'service_role' then
    for legajo in
      select distinct x.id from pg_catalog.unnest(ids) as x (id) order by x.id
    loop
      perform 1 from public.legajos as l where l.id = legajo for share;
      if public.hay_solicitud_pendiente(legajo) then
        raise exception 'The legajo has a pending change request'
          using errcode = '55000', hint = 'solicitud_pendiente';
      end if;
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.bloquear_hijos_pendiente() from public, anon, authenticated;

create trigger legajo_hijos_bloquear_pendiente
  before insert or update or delete on public.legajo_hijos
  for each row
  execute function public.bloquear_hijos_pendiente();

-- Same as F1-06B, plus the legajo row lock described above.
create or replace function public.crear_solicitud(p_legajo_id uuid, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  nueva uuid;
begin
  if public.current_app_role() is distinct from 'empleado'::public.app_role then
    raise exception 'Only an empleado can submit change requests' using errcode = '42501';
  end if;

  perform 1
  from public.legajos as l
  where l.id = p_legajo_id and l.profile_id = auth.uid()
  for no key update;
  if not found then
    raise exception 'Change requests are only for the own legajo' using errcode = '42501';
  end if;

  if p_items is null
    or pg_catalog.jsonb_typeof(p_items) <> 'array'
    or pg_catalog.jsonb_array_length(p_items) = 0
  then
    raise exception 'At least one item is required' using errcode = '22023';
  end if;

  -- Objects first, on their own: jsonb_object_keys raises on a non-object.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) as item
    where pg_catalog.jsonb_typeof(item) <> 'object'
  ) then
    raise exception 'Each item needs exactly campo and valor_propuesto' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) as item
    where (
        select pg_catalog.array_agg(key order by key)
        from pg_catalog.jsonb_object_keys(item) as key
      ) is distinct from array['campo', 'valor_propuesto']::text[]
      or pg_catalog.jsonb_typeof(item -> 'campo') <> 'string'
      or pg_catalog.jsonb_typeof(item -> 'valor_propuesto') not in ('string', 'null')
  ) then
    raise exception 'Each item needs exactly campo and valor_propuesto' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) as item
    group by item ->> 'campo'
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'A field appears more than once' using errcode = '22023';
  end if;

  insert into public.solicitudes_cambio (legajo_id, solicitado_por)
  values (p_legajo_id, auth.uid())
  returning id into nueva;

  insert into public.solicitudes_cambio_items (solicitud_id, campo, valor_propuesto)
  select nueva, item ->> 'campo', item ->> 'valor_propuesto'
  from pg_catalog.jsonb_array_elements(p_items) as item;

  return nueva;
end;
$$;

-- ---------------------------------------------------------------------------
-- Decisions: nobody decides on their own legajo
-- ---------------------------------------------------------------------------
-- crear_solicitud accepts only employees and Admin uploads are approved at
-- once, so an Admin's own item is pending only if the account was promoted
-- after submitting. The F1-06B functions did not check it; these do, with
-- 55000 and HINT 'cuenta_propia'. Everything else is unchanged, except that
-- aprobar_solicitud now marks the request before applying it (lock above)
-- and aprobar_documento records who replaced the previous document.
-- Error codes: 42501 caller is not an admin; 22023 blank rejection reason;
-- P0002 not found; 55000 not pending (no hint) or own legajo ('cuenta_propia').

create or replace function public.aprobar_solicitud(p_solicitud_id uuid)
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
  if exists (
    select 1 from public.legajos as l
    where l.id = solicitud.legajo_id and l.profile_id = auth.uid()
  ) then
    raise exception 'A change request on the own legajo cannot be decided by its owner'
      using errcode = '55000', hint = 'cuenta_propia';
  end if;

  -- First, so the pending-request lock no longer applies to this legajo.
  update public.solicitudes_cambio
  set estado = 'aprobada', revisado_por = auth.uid(), revisado_en = pg_catalog.now()
  where id = p_solicitud_id;

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
end;
$$;

create or replace function public.rechazar_solicitud(p_solicitud_id uuid, p_motivo text)
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
  if exists (
    select 1 from public.legajos as l
    where l.id = solicitud.legajo_id and l.profile_id = auth.uid()
  ) then
    raise exception 'A change request on the own legajo cannot be decided by its owner'
      using errcode = '55000', hint = 'cuenta_propia';
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

create or replace function public.aprobar_documento(p_documento_id uuid)
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
  if exists (
    select 1 from public.legajos as l
    where l.id = documento.legajo_id and l.profile_id = auth.uid()
  ) then
    raise exception 'A document of the own legajo cannot be decided by its owner'
      using errcode = '55000', hint = 'cuenta_propia';
  end if;

  -- First, so the one-approved-per-type index holds at every step.
  update public.legajo_documentos
  set estado = 'reemplazado', reemplazado_por = auth.uid(), reemplazado_en = pg_catalog.now()
  where legajo_id = documento.legajo_id
    and tipo = documento.tipo
    and estado = 'aprobado';

  update public.legajo_documentos
  set estado = 'aprobado', revisado_por = auth.uid(), revisado_en = pg_catalog.now()
  where id = p_documento_id;
end;
$$;

create or replace function public.rechazar_documento(p_documento_id uuid, p_motivo text)
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
  if exists (
    select 1 from public.legajos as l
    where l.id = documento.legajo_id and l.profile_id = auth.uid()
  ) then
    raise exception 'A document of the own legajo cannot be decided by its owner'
      using errcode = '55000', hint = 'cuenta_propia';
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

-- ---------------------------------------------------------------------------
-- Admin replacement of the current document
-- ---------------------------------------------------------------------------
-- Replaces the approved document of p_tipo in a legajo with a file the Admin
-- already uploaded to the employee's folder (the app checked the stored
-- object). With p_conservar_historial the previous row becomes 'reemplazado'
-- and its object stays; without it the previous row is deleted and its path
-- is returned, for the app to remove the object afterwards (a failed removal
-- leaves a rowless object that the folder sweep removes). One transaction:
-- any failure leaves the previous document as it was.
-- Error codes: 42501 caller is not an admin; 22023 missing mode or a path
-- outside the employee's folder; P0002 legajo or current document not found;
-- 55000 HINT 'documento_pendiente' when the employee has a pending document of
-- that type (it is decided in the inbox first). Table constraints (23514,
-- 23505) check the path, type, MIME type, size and name as for any upload.
create function public.reemplazar_documento(
  p_legajo_id uuid,
  p_tipo public.documento_tipo,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_conservar_historial boolean
)
returns table (documento_id uuid, storage_path_eliminado text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  vigente public.legajo_documentos%rowtype;
  nuevo uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can replace documents' using errcode = '42501';
  end if;
  if p_conservar_historial is null then
    raise exception 'The replacement mode is required' using errcode = '22023';
  end if;

  select l.profile_id into owner_id from public.legajos as l where l.id = p_legajo_id;
  if not found then
    raise exception 'Legajo not found' using errcode = 'P0002';
  end if;
  if pg_catalog.split_part(p_storage_path, '/', 1) is distinct from owner_id::text then
    raise exception 'The file is not in the employee''s folder' using errcode = '22023';
  end if;

  select * into vigente
  from public.legajo_documentos as d
  where d.legajo_id = p_legajo_id and d.tipo = p_tipo and d.estado = 'aprobado'
  for update;
  if not found then
    raise exception 'There is no current document to replace' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.legajo_documentos as d
    where d.legajo_id = p_legajo_id and d.tipo = p_tipo and d.estado = 'pendiente'
  ) then
    raise exception 'The employee has a pending document of this type'
      using errcode = '55000', hint = 'documento_pendiente';
  end if;

  -- The previous document leaves the approved state first, so the
  -- one-approved-per-type index holds at every step.
  if p_conservar_historial then
    update public.legajo_documentos
    set estado = 'reemplazado', reemplazado_por = auth.uid(), reemplazado_en = pg_catalog.now()
    where id = vigente.id;
  else
    delete from public.legajo_documentos where id = vigente.id;
  end if;

  insert into public.legajo_documentos (
    legajo_id, tipo, storage_path, file_name, mime_type, size_bytes, uploaded_by,
    estado, revisado_por, revisado_en
  )
  values (
    p_legajo_id, p_tipo, p_storage_path, p_file_name, p_mime_type, p_size_bytes, auth.uid(),
    'aprobado', auth.uid(), pg_catalog.now()
  )
  returning id into nuevo;

  return query
  select nuevo, case when p_conservar_historial then null else vigente.storage_path end;
end;
$$;

revoke execute on function public.reemplazar_documento(
  uuid, public.documento_tipo, text, text, text, bigint, boolean
) from public, anon;
grant execute on function public.reemplazar_documento(
  uuid, public.documento_tipo, text, text, text, bigint, boolean
) to authenticated;

-- ---------------------------------------------------------------------------
-- Replaced history: Admin only
-- ---------------------------------------------------------------------------
-- Admin already reads every row and object. Until now an Empleado could also
-- read their own 'reemplazado' rows and objects (the app filtered them out);
-- from here RLS hides them.
drop policy legajo_documentos_select_own_or_admin on public.legajo_documentos;

create policy legajo_documentos_select_own_or_admin
  on public.legajo_documentos
  for select
  to authenticated
  using (
    (select public.is_admin())
    or (
      estado <> 'reemplazado'
      and exists (
        select 1 from public.legajos as l
        where l.id = legajo_id and l.profile_id = (select auth.uid())
      )
    )
  );

-- The state of the document behind an object in the caller's own folder,
-- read past RLS: the storage policies need it, and the caller can no longer
-- see a replaced row (which would otherwise look like an orphan they may
-- delete). Null when no row points to the path or it is not in the caller's
-- folder.
create function public.estado_documento_propio(p_storage_path text)
returns public.documento_estado
language sql
stable
security definer
set search_path = ''
as $$
  select d.estado
  from public.legajo_documentos as d
  where d.storage_path = p_storage_path
    and pg_catalog.split_part(p_storage_path, '/', 1) = (select auth.uid())::text;
$$;

-- Storage policies run it as the caller.
revoke execute on function public.estado_documento_propio(text) from public, anon;
grant execute on function public.estado_documento_propio(text) to authenticated;

-- storage.objects, bucket legajo-docs. SELECT: own folder except replaced
-- documents, or Admin. UPDATE and DELETE: as in F1-06B (Admin; or own folder
-- while the document is pending or when no row points to the object), now
-- decided with estado_documento_propio. INSERT is unchanged.
drop policy legajo_docs_select_own_or_admin on storage.objects;
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
        split_part(objects.name, '/', 1) = (select auth.uid())::text
        and public.estado_documento_propio(objects.name) is distinct from 'reemplazado'
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
        split_part(objects.name, '/', 1) = (select auth.uid())::text
        and coalesce(public.estado_documento_propio(objects.name), 'pendiente') = 'pendiente'
      )
    )
  )
  with check (
    bucket_id = 'legajo-docs'
    and public.is_valid_legajo_doc_path(objects.name)
    and (
      split_part(objects.name, '/', 1) = (select auth.uid())::text
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
        split_part(objects.name, '/', 1) = (select auth.uid())::text
        and coalesce(public.estado_documento_propio(objects.name), 'pendiente') = 'pendiente'
      )
    )
  );
