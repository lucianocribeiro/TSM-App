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
