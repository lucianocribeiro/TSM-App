-- F2-03: receipts and signatures storage (PRD Fase 2 v0.5 §6, Constitution
-- §11). Two private buckets, read-only storage policies, and path ownership
-- constraints on the F2-02 tables (empty when this runs).
--
-- Path layouts, owner first (src/lib/recibos/paths.ts builds and parses them):
--   recibos: <empleado_id>/<periodo_id>/<uuid>.pdf
--   firmas:  <empleado_id>/<version>-<uuid>.png
--
-- No INSERT, UPDATE or DELETE policy on either bucket: uploads go through
-- signed upload URLs that the server creates after authorizing the caller,
-- and removals run server-side. Files are read only through 5-minute signed
-- URLs created under the SELECT policies below.

-- ---------------------------------------------------------------------------
-- Buckets (private). Idempotent, as the legajo-docs migration.
-- ---------------------------------------------------------------------------
-- recibos: 10 MB = 10485760 bytes, PDF only.
-- firmas: 1 MB = 1048576 bytes, PNG only (a drawn signature from a canvas).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('recibos', 'recibos', false, 10485760, array['application/pdf']),
  ('firmas', 'firmas', false, 1048576, array['image/png'])
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Storage policies: SELECT only, authenticated only, active accounts only
-- ---------------------------------------------------------------------------
-- An Admin reads every object of the bucket. An Empleado reads an object in
-- their own folder only when a row they can see references it: the EXISTS
-- reads public.recibos / public.firmas_empleado under those tables' own RLS
-- (own rows; receipts only in non-draft periods). So a draft period's file,
-- another employee's file, a replaced file (referenced only by the Admin-only
-- recibo_historial) and an unreferenced object are all out of reach.

create policy recibos_storage_select_propio_o_admin
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'recibos'
    and (select public.cuenta_activa())
    and (
      (select public.is_admin())
      or (
        (storage.foldername(objects.name))[1] = (select auth.uid())::text
        and exists (
          select 1 from public.recibos as r
          where r.archivo_path = objects.name
        )
      )
    )
  );

create policy firmas_storage_select_propio_o_admin
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'firmas'
    and (select public.cuenta_activa())
    and (
      (select public.is_admin())
      or (
        (storage.foldername(objects.name))[1] = (select auth.uid())::text
        and exists (
          select 1 from public.firmas_empleado as f
          where f.imagen_path = objects.name
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Path ownership: the first folder of every stored path is the row's owner
-- ---------------------------------------------------------------------------
-- Receipts and their history also carry the period folder; every receipt
-- path is a PDF, every signature path a PNG.

alter table public.recibos
  add constraint recibos_archivo_path_propietario
  check (
    starts_with(archivo_path, empleado_id::text || '/' || periodo_id::text || '/')
    and archivo_path like '%.pdf'
  );

alter table public.recibo_historial
  add constraint recibo_historial_archivo_path_propietario
  check (
    starts_with(archivo_path, empleado_id::text || '/' || periodo_id::text || '/')
    and archivo_path like '%.pdf'
  );

alter table public.firmas_empleado
  add constraint firmas_empleado_imagen_path_propietario
  check (
    starts_with(imagen_path, empleado_id::text || '/')
    and imagen_path like '%.png'
  );

-- recibo_overrides has no owner or period columns: a CHECK cannot read the
-- receipt, so a BEFORE INSERT trigger does (UPDATE is already refused by
-- recibo_overrides_solo_agregar). A missing receipt is left to the foreign
-- key (23503).
create function public.recibo_overrides_ruta_propietario()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_empleado_id uuid;
  v_periodo_id uuid;
begin
  select r.empleado_id, r.periodo_id
    into v_empleado_id, v_periodo_id
    from public.recibos as r
    where r.id = new.recibo_id;

  if found and not (
    starts_with(new.archivo_path, v_empleado_id::text || '/' || v_periodo_id::text || '/')
    and new.archivo_path like '%.pdf'
  ) then
    raise exception 'override path does not match its receipt'
      using errcode = '23514', hint = 'ruta_recibo_ajena';
  end if;

  return new;
end;
$$;

revoke execute on function public.recibo_overrides_ruta_propietario() from public, anon, authenticated;

create trigger recibo_overrides_ruta_propietario
  before insert on public.recibo_overrides
  for each row
  execute function public.recibo_overrides_ruta_propietario();
