-- CR-2: Datos laborales (group E) from the Configuración lists, Admin only.
--
-- Group E moves out of public.legajos into public.legajos_laborales, one row
-- per legajo, keyed by the legajo id. Every operation on it is limited to an
-- active Admin by RLS (is_admin()). An Empleado keeps reading their own
-- legajos row (groups A to D), which no longer carries any group E column,
-- so no table, view or function that reads public.legajos can return a group
-- E value to them. Column grants alone could not do this: Admin and Empleado
-- are both the authenticated role.
--
-- Fields (PRD 5.5): número de legajo (unique), Área, Puesto (within the
-- Área), fecha de ingreso, estado laboral, Sucursal (was Sede), Tarea
-- (replaces Modalidad), Convenio and Categoría. Bruto mensual and Modalidad
-- are dropped with their data. Antigüedad is still calculated, never stored.
--
-- List references (the CR-1 plan): per field, the item id plus a constant
-- generated list column, and a composite foreign key (id, lista) to
-- catalogo_items, ON DELETE RESTRICT. The item always belongs to the right
-- list, and an item in use cannot be deleted. The Puesto belongs to the
-- legajo's Área through (puesto_id, area_id) -> catalogo_items (id, area_id).
--
-- Required fields (PRD 5.7): número de legajo, Área, Puesto, fecha de
-- ingreso, estado laboral and Sucursal. The row of a new legajo starts empty,
-- and a legajo migrated incomplete stays so until its group E is next saved:
-- the rule applies to every write that sets or changes a group E value
-- (legajos_laborales_validar). The same write may only newly choose an
-- active item (and a Puesto of an active Área).

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
create table public.legajos_laborales (
  legajo_id uuid primary key references public.legajos (id) on delete cascade,
  numero_legajo text unique,
  area_id uuid,
  area_lista public.catalogo_lista generated always as ('area'::public.catalogo_lista) stored,
  puesto_id uuid,
  puesto_lista public.catalogo_lista generated always as ('puesto'::public.catalogo_lista) stored,
  fecha_ingreso date,
  estado_laboral public.estado_laboral,
  sucursal_id uuid,
  sucursal_lista public.catalogo_lista generated always as ('sucursal'::public.catalogo_lista) stored,
  tarea_id uuid,
  tarea_lista public.catalogo_lista generated always as ('tarea'::public.catalogo_lista) stored,
  convenio_id uuid,
  convenio_lista public.catalogo_lista generated always as ('convenio'::public.catalogo_lista) stored,
  categoria_id uuid,
  categoria_lista public.catalogo_lista generated always as ('categoria'::public.catalogo_lista) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint legajos_laborales_area_fkey
    foreign key (area_id, area_lista) references public.catalogo_items (id, lista) on delete restrict,
  constraint legajos_laborales_puesto_fkey
    foreign key (puesto_id, puesto_lista) references public.catalogo_items (id, lista) on delete restrict,
  constraint legajos_laborales_puesto_area_fkey
    foreign key (puesto_id, area_id) references public.catalogo_items (id, area_id) on delete restrict,
  constraint legajos_laborales_sucursal_fkey
    foreign key (sucursal_id, sucursal_lista) references public.catalogo_items (id, lista) on delete restrict,
  constraint legajos_laborales_tarea_fkey
    foreign key (tarea_id, tarea_lista) references public.catalogo_items (id, lista) on delete restrict,
  constraint legajos_laborales_convenio_fkey
    foreign key (convenio_id, convenio_lista) references public.catalogo_items (id, lista) on delete restrict,
  constraint legajos_laborales_categoria_fkey
    foreign key (categoria_id, categoria_lista) references public.catalogo_items (id, lista) on delete restrict,
  -- A simple-match key skips a row with a null column: without an Área the
  -- Puesto key above would not be checked, so a Puesto needs its Área.
  constraint legajos_laborales_puesto_con_area check (puesto_id is null or area_id is not null)
);

-- The RESTRICT checks of a catalog delete look items up by these.
create index legajos_laborales_area_id_idx on public.legajos_laborales (area_id);
create index legajos_laborales_puesto_id_idx on public.legajos_laborales (puesto_id);
create index legajos_laborales_sucursal_id_idx on public.legajos_laborales (sucursal_id);
create index legajos_laborales_tarea_id_idx on public.legajos_laborales (tarea_id);
create index legajos_laborales_convenio_id_idx on public.legajos_laborales (convenio_id);
create index legajos_laborales_categoria_id_idx on public.legajos_laborales (categoria_id);

alter table public.legajos_laborales enable row level security;

create trigger legajos_laborales_set_updated_at
  before update on public.legajos_laborales
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Existing values -> list items
-- ---------------------------------------------------------------------------
-- The item of a list (for a Puesto, of an Área) whose name matches the text
-- as the lists compare names: trimmed, repeated spaces as one, without case
-- or accents (catalogo_items.clave). Null when nothing matches. Used by the
-- data migration below; kept for its integration test (service role only).
create function public.catalogo_item_por_texto(p_lista public.catalogo_lista, p_area_id uuid, p_texto text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select i.id
  from public.catalogo_items as i
  where i.lista = p_lista
    and i.area_id is not distinct from p_area_id
    and i.clave = pg_catalog.lower(pg_catalog.translate(
      pg_catalog.btrim(pg_catalog.regexp_replace(p_texto, '\s+', ' ', 'g')),
      'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc'
    ));
$$;

revoke execute on function public.catalogo_item_por_texto(public.catalogo_lista, uuid, text) from public, anon, authenticated;
grant execute on function public.catalogo_item_por_texto(public.catalogo_lista, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Data migration (before any trigger on the new table: a legajo may move
-- incomplete)
-- ---------------------------------------------------------------------------
-- Every legajo gets its row. Área, Sede (now Sucursal) and Convenio map to
-- their list items; the Puesto within the mapped Área. Unmatched values
-- become null. Modalidad and bruto mensual are not carried over.
insert into public.legajos_laborales (
  legajo_id, numero_legajo, area_id, fecha_ingreso, estado_laboral, sucursal_id, convenio_id
)
select
  l.id,
  l.numero_legajo,
  public.catalogo_item_por_texto('area', null, l.area),
  l.fecha_ingreso,
  l.estado_laboral,
  public.catalogo_item_por_texto('sucursal', null, l.sede),
  public.catalogo_item_por_texto('convenio', null, l.convenio)
from public.legajos as l;

update public.legajos_laborales as ll
set puesto_id = public.catalogo_item_por_texto('puesto', ll.area_id, l.puesto)
from public.legajos as l
where l.id = ll.legajo_id and ll.area_id is not null;

-- Counts only (no values), for the apply log.
do $$
declare
  r record;
begin
  select
    pg_catalog.count(*) as filas,
    pg_catalog.count(*) filter (where pg_catalog.btrim(coalesce(l.area, '')) <> '' and ll.area_id is not null) as area_ok,
    pg_catalog.count(*) filter (where pg_catalog.btrim(coalesce(l.area, '')) <> '' and ll.area_id is null) as area_null,
    pg_catalog.count(*) filter (where pg_catalog.btrim(coalesce(l.puesto, '')) <> '' and ll.puesto_id is not null) as puesto_ok,
    pg_catalog.count(*) filter (where pg_catalog.btrim(coalesce(l.puesto, '')) <> '' and ll.puesto_id is null) as puesto_null,
    pg_catalog.count(*) filter (where pg_catalog.btrim(coalesce(l.sede, '')) <> '' and ll.sucursal_id is not null) as sucursal_ok,
    pg_catalog.count(*) filter (where pg_catalog.btrim(coalesce(l.sede, '')) <> '' and ll.sucursal_id is null) as sucursal_null,
    pg_catalog.count(*) filter (where pg_catalog.btrim(coalesce(l.convenio, '')) <> '' and ll.convenio_id is not null) as convenio_ok,
    pg_catalog.count(*) filter (where pg_catalog.btrim(coalesce(l.convenio, '')) <> '' and ll.convenio_id is null) as convenio_null,
    pg_catalog.count(*) filter (where pg_catalog.btrim(coalesce(l.modalidad, '')) <> '') as modalidad_descartada,
    pg_catalog.count(*) filter (where l.bruto_mensual is not null) as bruto_descartado
  into r
  from public.legajos as l
  join public.legajos_laborales as ll on ll.legajo_id = l.id;

  raise notice 'CR-2 datos laborales: rows %; matched area % puesto % sucursal % convenio %; set to null area % puesto % sucursal % convenio %; dropped modalidad % bruto_mensual %',
    r.filas, r.area_ok, r.puesto_ok, r.sucursal_ok, r.convenio_ok,
    r.area_null, r.puesto_null, r.sucursal_null, r.convenio_null,
    r.modalidad_descartada, r.bruto_descartado;
end;
$$;

-- ---------------------------------------------------------------------------
-- Group E leaves public.legajos
-- ---------------------------------------------------------------------------
-- The group E trigger goes first: it names the columns. Dropping the columns
-- drops their grants, the unique número de legajo and the bruto check.
drop trigger legajos_protect_laboral on public.legajos;
drop function public.protect_legajo_laboral();

alter table public.legajos
  drop column numero_legajo,
  drop column area,
  drop column puesto,
  drop column fecha_ingreso,
  drop column estado_laboral,
  drop column sede,
  drop column modalidad,
  drop column convenio,
  drop column bruto_mensual;

-- ---------------------------------------------------------------------------
-- Every new legajo gets its (empty) group E row
-- ---------------------------------------------------------------------------
create function public.crear_legajo_laboral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.legajos_laborales (legajo_id) values (new.id);
  return new;
end;
$$;

revoke execute on function public.crear_legajo_laboral() from public, anon, authenticated;

create trigger legajos_crear_laboral
  after insert on public.legajos
  for each row
  execute function public.crear_legajo_laboral();

-- ---------------------------------------------------------------------------
-- Required fields and active items
-- ---------------------------------------------------------------------------
-- A write that sets (insert) or changes (update) any group E value must
-- leave the six required fields filled, and may only newly choose an active
-- item; a newly chosen Puesto also needs an active Área. Values kept as they
-- were (an item deactivated since) stay valid. A caller who is not an Admin
-- is left to RLS, which refuses them without this check revealing anything.
-- Direct database connections and the service role are checked too.
create function public.legajos_laborales_validar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_role text := auth.jwt() ->> 'role';
  antes public.legajos_laborales%rowtype;
  cambia boolean;
  item uuid;
begin
  if jwt_role is not null and jwt_role <> 'service_role' and not public.is_admin() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    antes := old;
  end if;

  cambia := new.numero_legajo is distinct from antes.numero_legajo
    or new.area_id is distinct from antes.area_id
    or new.puesto_id is distinct from antes.puesto_id
    or new.fecha_ingreso is distinct from antes.fecha_ingreso
    or new.estado_laboral is distinct from antes.estado_laboral
    or new.sucursal_id is distinct from antes.sucursal_id
    or new.tarea_id is distinct from antes.tarea_id
    or new.convenio_id is distinct from antes.convenio_id
    or new.categoria_id is distinct from antes.categoria_id;
  if not cambia then
    return new;
  end if;

  if pg_catalog.btrim(coalesce(new.numero_legajo, '')) = ''
    or new.area_id is null
    or new.puesto_id is null
    or new.fecha_ingreso is null
    or new.estado_laboral is null
    or new.sucursal_id is null
  then
    raise exception 'Datos laborales are incomplete'
      using errcode = '23514', hint = 'laborales_incompletos';
  end if;

  foreach item in array array[
    case when new.area_id is distinct from antes.area_id then new.area_id end,
    case when new.puesto_id is distinct from antes.puesto_id then new.puesto_id end,
    case when new.sucursal_id is distinct from antes.sucursal_id then new.sucursal_id end,
    case when new.tarea_id is distinct from antes.tarea_id then new.tarea_id end,
    case when new.convenio_id is distinct from antes.convenio_id then new.convenio_id end,
    case when new.categoria_id is distinct from antes.categoria_id then new.categoria_id end
  ]
  loop
    if item is not null and not exists (
      select 1 from public.catalogo_items as i where i.id = item and i.activo
    ) then
      raise exception 'A list item that is not active cannot be chosen'
        using errcode = '23514', hint = 'item_inactivo';
    end if;
  end loop;

  if new.puesto_id is distinct from antes.puesto_id and not exists (
    select 1 from public.catalogo_items as a where a.id = new.area_id and a.activo
  ) then
    raise exception 'A list item that is not active cannot be chosen'
      using errcode = '23514', hint = 'item_inactivo';
  end if;

  return new;
end;
$$;

revoke execute on function public.legajos_laborales_validar() from public, anon, authenticated;

create trigger legajos_laborales_validar
  before insert or update on public.legajos_laborales
  for each row
  execute function public.legajos_laborales_validar();

-- ---------------------------------------------------------------------------
-- Grants and policies: active Admin only
-- ---------------------------------------------------------------------------
-- No DELETE grant: the row goes only with its legajo (cascade), so every
-- legajo keeps exactly one. INSERT names the legajo and the values; UPDATE
-- only the values; never the timestamps or the list columns.
revoke all on table public.legajos_laborales from anon, authenticated;
grant select on table public.legajos_laborales to authenticated;
grant insert (
  legajo_id, numero_legajo, area_id, puesto_id, fecha_ingreso, estado_laboral,
  sucursal_id, tarea_id, convenio_id, categoria_id
) on table public.legajos_laborales to authenticated;
grant update (
  numero_legajo, area_id, puesto_id, fecha_ingreso, estado_laboral,
  sucursal_id, tarea_id, convenio_id, categoria_id
) on table public.legajos_laborales to authenticated;

create policy legajos_laborales_select_admin
  on public.legajos_laborales
  for select
  to authenticated
  using ((select public.is_admin()));

create policy legajos_laborales_insert_admin
  on public.legajos_laborales
  for insert
  to authenticated
  with check ((select public.is_admin()));

create policy legajos_laborales_update_admin
  on public.legajos_laborales
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
