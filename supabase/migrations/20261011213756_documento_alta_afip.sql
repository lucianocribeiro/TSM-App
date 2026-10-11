-- CR-3: the "Alta de AFIP" document. Optional, uploaded, replaced and deleted
-- by an Admin only; the employee reads and downloads their own current one.
--
-- One file. The new enum value is added here and never used as an enum value
-- in this transaction (PostgreSQL refuses a value added in the same
-- transaction): every rule below compares tipo::text or the path's type
-- folder, which is text.

-- ---------------------------------------------------------------------------
-- Type
-- ---------------------------------------------------------------------------
alter type public.documento_tipo add value 'alta_afip';

-- ---------------------------------------------------------------------------
-- Object path convention: the new type folder
-- ---------------------------------------------------------------------------
-- As in F1-06, with alta_afip among the type folders. Mirrors
-- src/lib/documentos/paths.ts.
create or replace function public.is_valid_legajo_doc_path(path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    path ~ (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '/(dni_frente|dni_dorso|licencia_conducir|alta_afip)/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(pdf|jpg|png)$'
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Never pending
-- ---------------------------------------------------------------------------
-- Only an Admin creates an Alta de AFIP, and Admin uploads are approved at
-- once, so it is never pending (and never rejected, which needs a pending
-- document first). Holds for every role, the service role included. It also
-- keeps the employee's delete path (own pending documents) away from it.
alter table public.legajo_documentos
  add constraint legajo_documentos_alta_afip_aprobado
    check (tipo::text <> 'alta_afip' or estado in ('aprobado', 'reemplazado'));

-- ---------------------------------------------------------------------------
-- legajo_documentos: the owner never inserts an Alta de AFIP
-- ---------------------------------------------------------------------------
-- As in F1-11A, plus: a non-admin caller cannot insert the alta_afip type.
-- UPDATE is Admin only, and the owner's DELETE needs a pending document,
-- which an Alta de AFIP never is: both unchanged. SELECT is unchanged: the
-- owner reads their own current document, not the replaced ones.
drop policy legajo_documentos_insert_own_or_admin on public.legajo_documentos;

create policy legajo_documentos_insert_own_or_admin
  on public.legajo_documentos
  for insert
  to authenticated
  with check (
    (select public.cuenta_activa())
    and uploaded_by = (select auth.uid())
    and estado = (
      case when (select public.is_admin())
        then 'aprobado'::public.documento_estado
        else 'pendiente'::public.documento_estado
      end
    )
    and (tipo::text <> 'alta_afip' or (select public.is_admin()))
    and exists (
      select 1 from public.legajos as l
      where l.id = legajo_id
        and (l.profile_id = (select auth.uid()) or (select public.is_admin()))
        and split_part(storage_path, '/', 1) = l.profile_id::text
    )
  );

-- ---------------------------------------------------------------------------
-- storage.objects (legajo-docs): the owner never writes under alta_afip/
-- ---------------------------------------------------------------------------
-- As in F1-11A, plus: the own-folder branch of INSERT, UPDATE (both the row
-- reached and the new name) and DELETE excludes the alta_afip type folder,
-- including rowless objects there. The Admin branches are unchanged. SELECT
-- is unchanged: the owner downloads their own current Alta de AFIP.
drop policy legajo_docs_insert_own_or_admin on storage.objects;
drop policy legajo_docs_update_admin_or_own_pending on storage.objects;
drop policy legajo_docs_delete_admin_or_own_pending on storage.objects;

create policy legajo_docs_insert_own_or_admin
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'legajo-docs'
    and public.is_valid_legajo_doc_path(objects.name)
    and (
      (
        (select public.cuenta_activa())
        and split_part(objects.name, '/', 1) = (select auth.uid())::text
        and split_part(objects.name, '/', 2) <> 'alta_afip'
      )
      or (
        (select public.is_admin())
        and exists (
          select 1 from public.profiles as p
          where p.id::text = split_part(objects.name, '/', 1)
        )
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
        (select public.cuenta_activa())
        and split_part(objects.name, '/', 1) = (select auth.uid())::text
        and split_part(objects.name, '/', 2) <> 'alta_afip'
        and coalesce(public.estado_documento_propio(objects.name), 'pendiente') = 'pendiente'
      )
    )
  )
  with check (
    bucket_id = 'legajo-docs'
    and public.is_valid_legajo_doc_path(objects.name)
    and (
      (
        (select public.cuenta_activa())
        and split_part(objects.name, '/', 1) = (select auth.uid())::text
        and split_part(objects.name, '/', 2) <> 'alta_afip'
      )
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
        (select public.cuenta_activa())
        and split_part(objects.name, '/', 1) = (select auth.uid())::text
        and split_part(objects.name, '/', 2) <> 'alta_afip'
        and coalesce(public.estado_documento_propio(objects.name), 'pendiente') = 'pendiente'
      )
    )
  );
