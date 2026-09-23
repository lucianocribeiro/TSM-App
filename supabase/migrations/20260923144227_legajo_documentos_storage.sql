-- F1-06: legajo documents. Private bucket, metadata table, access rules and RLS.

-- ---------------------------------------------------------------------------
-- Document type enum (stable codes; display labels live in the copy module)
-- ---------------------------------------------------------------------------
-- PRD scope item 6: DNI frente and dorso (required), licencia de conducir (optional).
-- The required/optional flag lives in src/lib/documentos/tipos.ts.
create type public.documento_tipo as enum (
  'dni_frente',
  'dni_dorso',
  'licencia_conducir'
);

-- ---------------------------------------------------------------------------
-- Object path convention: <profile_id>/<tipo>/<uuid>.<ext>
-- ---------------------------------------------------------------------------
-- Lowercase UUIDs, one of the three types, and one extension per allowed MIME
-- type (pdf, jpg, png). Anything else, including traversal segments, leading
-- slashes and extra folders, does not match. Mirrors src/lib/documentos/paths.ts.
create function public.is_valid_legajo_doc_path(path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    path ~ (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '/(dni_frente|dni_dorso|licencia_conducir)/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(pdf|jpg|png)$'
    ),
    false
  );
$$;

revoke execute on function public.is_valid_legajo_doc_path(text) from public, anon;
grant execute on function public.is_valid_legajo_doc_path(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket (private). Idempotent so the migration can be re-applied.
-- ---------------------------------------------------------------------------
-- 10 MB = 10485760 bytes, the same limit as legajo_documentos.size_bytes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'legajo-docs',
  'legajo-docs',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Metadata: one current document per type and legajo
-- ---------------------------------------------------------------------------
-- Replacing a document updates its row and removes the old object (app level).
create table public.legajo_documentos (
  id uuid primary key default gen_random_uuid(),
  legajo_id uuid not null references public.legajos (id) on delete cascade,
  tipo public.documento_tipo not null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint legajo_documentos_legajo_tipo_key unique (legajo_id, tipo),

  constraint legajo_documentos_storage_path_valido
    check (public.is_valid_legajo_doc_path(storage_path)),

  -- The type folder in the path matches the row's type.
  constraint legajo_documentos_storage_path_tipo
    check (split_part(storage_path, '/', 2) = tipo::text),

  constraint legajo_documentos_mime_type_valido
    check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),

  -- The path extension matches the MIME type.
  constraint legajo_documentos_mime_extension
    check (
      (mime_type = 'application/pdf' and storage_path like '%.pdf')
      or (mime_type = 'image/jpeg' and storage_path like '%.jpg')
      or (mime_type = 'image/png' and storage_path like '%.png')
    ),

  constraint legajo_documentos_size_bytes
    check (size_bytes > 0 and size_bytes <= 10485760),

  constraint legajo_documentos_file_name
    check (file_name ~ '[^[:space:]]' and char_length(file_name) <= 255)
);

create index legajo_documentos_uploaded_by_idx on public.legajo_documentos (uploaded_by);

alter table public.legajo_documentos enable row level security;

create trigger legajo_documentos_set_updated_at
  before update on public.legajo_documentos
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- anon: none. authenticated: RLS decides the rows. legajo_id and tipo are not
-- updatable, so a document never moves to another legajo or type.
revoke all on table public.legajo_documentos from anon, authenticated;

grant select, delete on table public.legajo_documentos to authenticated;
grant insert (legajo_id, tipo, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  on table public.legajo_documentos to authenticated;
grant update (storage_path, file_name, mime_type, size_bytes, uploaded_by)
  on table public.legajo_documentos to authenticated;

-- ---------------------------------------------------------------------------
-- Policies: legajo_documentos (parent legajo owned by the caller, or Admin)
-- ---------------------------------------------------------------------------
-- The subqueries read public.legajos under its own RLS, so they only find the
-- caller's legajo (or any legajo for Admin).
create policy legajo_documentos_select_own_or_admin
  on public.legajo_documentos
  for select
  to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.legajos as l
      where l.id = legajo_id and l.profile_id = (select auth.uid())
    )
  );

-- Writes: the caller is the uploader, and the object lives in the folder of
-- the legajo's owner.
create policy legajo_documentos_insert_own_or_admin
  on public.legajo_documentos
  for insert
  to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.legajos as l
      where l.id = legajo_id
        and (l.profile_id = (select auth.uid()) or (select public.is_admin()))
        and split_part(storage_path, '/', 1) = l.profile_id::text
    )
  );

create policy legajo_documentos_update_own_or_admin
  on public.legajo_documentos
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
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.legajos as l
      where l.id = legajo_id
        and (l.profile_id = (select auth.uid()) or (select public.is_admin()))
        and split_part(storage_path, '/', 1) = l.profile_id::text
    )
  );

create policy legajo_documentos_delete_own_or_admin
  on public.legajo_documentos
  for delete
  to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.legajos as l
      where l.id = legajo_id and l.profile_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Policies: storage.objects, bucket legajo-docs only
-- ---------------------------------------------------------------------------
-- The first path segment is the owning employee's profile id. No policy for
-- anon, and the bucket is private, so objects are never publicly readable;
-- downloads go through signed URLs created under these policies.

-- SELECT (download, list, signed URL): own folder, or Admin.
create policy legajo_docs_select_own_or_admin
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'legajo-docs'
    and (
      split_part(name, '/', 1) = (select auth.uid())::text
      or (select public.is_admin())
    )
  );

-- INSERT (upload): valid path, in the caller's own folder, or Admin in the
-- folder of an existing profile.
create policy legajo_docs_insert_own_or_admin
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'legajo-docs'
    and public.is_valid_legajo_doc_path(name)
    and (
      split_part(name, '/', 1) = (select auth.uid())::text
      or (
        (select public.is_admin())
        and exists (
          select 1 from public.profiles as p
          where p.id::text = split_part(name, '/', 1)
        )
      )
    )
  );

-- UPDATE (overwrite, move): reachable rows as SELECT; the new name follows the
-- INSERT rule, so an object cannot be moved out of a valid path or folder.
create policy legajo_docs_update_own_or_admin
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'legajo-docs'
    and (
      split_part(name, '/', 1) = (select auth.uid())::text
      or (select public.is_admin())
    )
  )
  with check (
    bucket_id = 'legajo-docs'
    and public.is_valid_legajo_doc_path(name)
    and (
      split_part(name, '/', 1) = (select auth.uid())::text
      or (
        (select public.is_admin())
        and exists (
          select 1 from public.profiles as p
          where p.id::text = split_part(name, '/', 1)
        )
      )
    )
  );

-- DELETE: own folder, or Admin.
create policy legajo_docs_delete_own_or_admin
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'legajo-docs'
    and (
      split_part(name, '/', 1) = (select auth.uid())::text
      or (select public.is_admin())
    )
  );
