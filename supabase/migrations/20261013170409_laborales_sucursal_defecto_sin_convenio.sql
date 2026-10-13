-- CR-5: Datos laborales rules (client log 12/10/2026).
--
-- 1. Sucursal por defecto per Puesto, configurable in Configuración: a Puesto
--    item may name a Sucursal item (sucursal_defecto_id). The legajo form
--    prefills the Sucursal with it when the Admin picks that Puesto (only
--    while that Sucursal is active); the Admin can change it afterwards.
--    Same list-safe reference as legajos_laborales: the id plus a constant
--    generated list column and a composite foreign key to (id, lista), ON
--    DELETE RESTRICT, so it always names a Sucursal and a Sucursal used as a
--    default cannot be deleted (it can be deactivated). It changes through
--    the existing Configuración write path (column UPDATE grant, RLS Admin
--    only), which bumps the version; the history records it as a new action,
--    sucursal_defecto, with the Sucursal names before and after.
-- 2. Convenio "No": one convenio item is marked sin_convenio (at most one,
--    convenio list only). This migration creates it, or marks an existing
--    item named "No" (ignoring case and accents). It is a system item: it
--    cannot be deleted, deactivated, renamed or unmarked, by any caller (the
--    service role included); it can be reordered.
-- 3. legajos_laborales_validar: Convenio becomes the seventh required field,
--    and the "No" convenio leaves Tarea and Categoría empty. As before, the
--    rules apply to a write that sets or changes a group E value: existing
--    legajos are not migrated and are corrected on their next save.

-- ---------------------------------------------------------------------------
-- History action
-- ---------------------------------------------------------------------------
-- Used only by registrar_catalogo_evento at run time, never in this
-- migration (no user is signed in here, so the trigger records nothing).
alter type public.catalogo_accion add value 'sucursal_defecto';

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.catalogo_items
  add column sucursal_defecto_id uuid,
  add column sin_convenio boolean not null default false;

alter table public.catalogo_items
  add column sucursal_defecto_lista public.catalogo_lista generated always as (
    case when sucursal_defecto_id is not null then 'sucursal'::public.catalogo_lista end
  ) stored;

alter table public.catalogo_items
  add constraint catalogo_items_sucursal_defecto_fkey
    foreign key (sucursal_defecto_id, sucursal_defecto_lista) references public.catalogo_items (id, lista) on delete restrict,
  add constraint catalogo_items_sucursal_defecto_solo_puesto check (sucursal_defecto_id is null or lista = 'puesto'),
  add constraint catalogo_items_sin_convenio_solo_convenio check (not sin_convenio or lista = 'convenio');

-- At most one "sin convenio" item.
create unique index catalogo_items_sin_convenio_unico on public.catalogo_items (lista) where sin_convenio;

-- The RESTRICT check of a Sucursal delete looks Puestos up by this.
create index catalogo_items_sucursal_defecto_id_idx on public.catalogo_items (sucursal_defecto_id);

-- The Admin sets or clears a Puesto's default (RLS: active Admin only). The
-- mark is not granted: only this migration sets it.
grant update (sucursal_defecto_id) on table public.catalogo_items to authenticated;

-- ---------------------------------------------------------------------------
-- Rules: the system item and a newly chosen default
-- ---------------------------------------------------------------------------
-- Every caller, the service role and direct connections included. Error
-- codes: 55000 HINT item_sistema (the "No" convenio cannot be deleted,
-- deactivated, renamed or unmarked); 23514 HINT item_inactivo (a default
-- Sucursal must be active when it is chosen; one deactivated later stays).
-- Plain invoker: it reads only catalogo_items, which the writer (an active
-- Admin, or the service role) can read.
create function public.catalogo_items_reglas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.sin_convenio then
      raise exception 'A system item cannot be deleted' using errcode = '55000', hint = 'item_sistema';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.sin_convenio and (
    new.nombre is distinct from old.nombre
    or (old.activo and not new.activo)
    or not new.sin_convenio
  ) then
    raise exception 'A system item cannot be renamed, deactivated or unmarked' using errcode = '55000', hint = 'item_sistema';
  end if;

  -- An id that is not a Sucursal is left to the foreign key (23503).
  if new.sucursal_defecto_id is not null
    and (tg_op = 'INSERT' or new.sucursal_defecto_id is distinct from old.sucursal_defecto_id)
    and exists (
      select 1 from public.catalogo_items as s
      where s.id = new.sucursal_defecto_id and s.lista = 'sucursal' and not s.activo
    )
  then
    raise exception 'A list item that is not active cannot be chosen' using errcode = '23514', hint = 'item_inactivo';
  end if;

  return new;
end;
$$;

revoke execute on function public.catalogo_items_reglas() from public, anon, authenticated;

create trigger catalogo_items_reglas
  before insert or update or delete on public.catalogo_items
  for each row
  execute function public.catalogo_items_reglas();

-- ---------------------------------------------------------------------------
-- History: the default Sucursal
-- ---------------------------------------------------------------------------
-- As in CR-1, plus one branch: a change of sucursal_defecto_id records the
-- action sucursal_defecto with the Sucursal names (before and after, null
-- for none), as they were then.
create or replace function public.registrar_catalogo_evento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  fila public.catalogo_items;
  area text;
begin
  if actor is null then
    return null;
  end if;

  if tg_op = 'DELETE' then
    fila := old;
  else
    fila := new;
  end if;
  if fila.area_id is not null then
    select a.nombre into area from public.catalogo_items as a where a.id = fila.area_id;
  end if;

  if tg_op = 'INSERT' then
    insert into public.catalogo_eventos (item_id, lista, item_nombre, area_nombre, accion, valor_nuevo, actor_id)
    values (new.id, new.lista, new.nombre, area, 'alta', new.nombre, actor);
  elsif tg_op = 'DELETE' then
    insert into public.catalogo_eventos (item_id, lista, item_nombre, area_nombre, accion, valor_anterior, actor_id)
    values (old.id, old.lista, old.nombre, area, 'baja', old.nombre, actor);
  else
    if new.nombre is distinct from old.nombre then
      insert into public.catalogo_eventos (item_id, lista, item_nombre, area_nombre, accion, valor_anterior, valor_nuevo, actor_id)
      values (new.id, new.lista, new.nombre, area, 'renombre', old.nombre, new.nombre, actor);
    end if;
    if new.activo is distinct from old.activo then
      insert into public.catalogo_eventos (item_id, lista, item_nombre, area_nombre, accion, valor_anterior, valor_nuevo, actor_id)
      values (
        new.id, new.lista, new.nombre, area,
        case when new.activo then 'reactivacion' else 'desactivacion' end::public.catalogo_accion,
        case when old.activo then 'activo' else 'inactivo' end,
        case when new.activo then 'activo' else 'inactivo' end,
        actor
      );
    end if;
    if new.posicion is distinct from old.posicion then
      insert into public.catalogo_eventos (item_id, lista, item_nombre, area_nombre, accion, valor_anterior, valor_nuevo, actor_id)
      values (new.id, new.lista, new.nombre, area, 'reorden', old.posicion::text, new.posicion::text, actor);
    end if;
    if new.sucursal_defecto_id is distinct from old.sucursal_defecto_id then
      insert into public.catalogo_eventos (item_id, lista, item_nombre, area_nombre, accion, valor_anterior, valor_nuevo, actor_id)
      values (
        new.id, new.lista, new.nombre, area, 'sucursal_defecto',
        (select s.nombre from public.catalogo_items as s where s.id = old.sucursal_defecto_id),
        (select s.nombre from public.catalogo_items as s where s.id = new.sucursal_defecto_id),
        actor
      );
    end if;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Convenio "No"
-- ---------------------------------------------------------------------------
-- Creates the "No" convenio at the end of the list, or marks the convenio
-- already named "No" (ignoring case and accents: catalogo_items.clave).
-- Idempotent: once marked, nothing changes. Returns what it did: creado,
-- marcado or existente. Service role only (kept for its integration test).
create function public.sembrar_convenio_no()
returns text
language plpgsql
set search_path = ''
as $$
declare
  existente public.catalogo_items;
begin
  select * into existente from public.catalogo_items as i where i.lista = 'convenio' and i.clave = 'no';
  if not found then
    insert into public.catalogo_items (lista, nombre, sin_convenio) values ('convenio', 'No', true);
    return 'creado';
  end if;
  if existente.sin_convenio then
    return 'existente';
  end if;
  update public.catalogo_items set sin_convenio = true where id = existente.id;
  return 'marcado';
end;
$$;

revoke execute on function public.sembrar_convenio_no() from public, anon, authenticated;
grant execute on function public.sembrar_convenio_no() to service_role;

-- What happened, for the apply log (no other data changes).
do $$
declare
  resultado text := public.sembrar_convenio_no();
begin
  raise notice 'CR-5 convenio No: %; created %, existing item marked %',
    resultado,
    case when resultado = 'creado' then 1 else 0 end,
    case when resultado = 'marcado' then 1 else 0 end;
end;
$$;

-- ---------------------------------------------------------------------------
-- legajos_laborales_validar: Convenio required, "No" without Tarea/Categoría
-- ---------------------------------------------------------------------------
-- As in CR-2, plus: convenio_id among the required fields (seven), and with
-- the "No" convenio (sin_convenio) Tarea and Categoría must be empty (23514
-- HINT sin_convenio). Other convenios keep Tarea and Categoría optional.
create or replace function public.legajos_laborales_validar()
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
    or new.convenio_id is null
  then
    raise exception 'Datos laborales are incomplete'
      using errcode = '23514', hint = 'laborales_incompletos';
  end if;

  if (new.tarea_id is not null or new.categoria_id is not null) and exists (
    select 1 from public.catalogo_items as c where c.id = new.convenio_id and c.sin_convenio
  ) then
    raise exception 'Tarea and Categoría do not apply without a convenio'
      using errcode = '23514', hint = 'sin_convenio';
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
