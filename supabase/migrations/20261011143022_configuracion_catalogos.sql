-- CR-1: Configuración. Admin-maintained lists (Área, Puesto, Sucursal,
-- Convenio, Tarea, Categoría) and their change history (PRD "Configuración").
--
-- Model: one table for every list, with the list as a discriminator.
-- - (id, lista) is unique, so a reference can name the list it expects:
--   CR-2 adds, per legajo field, the item id plus a constant list column and
--   a composite foreign key to (id, lista), ON DELETE RESTRICT. The item
--   then always belongs to the right list, and an item in use cannot be
--   deleted.
-- - A Puesto belongs to one Área through the same kind of key, (area_id,
--   area_lista) -> (id, lista). CR-2 enforces "the legajo's Puesto belongs
--   to its Área" with a foreign key (puesto_id, area_id) -> (id, area_id),
--   which is unique too.
-- - Names are unique per list (for Puesto, per Área), ignoring case,
--   accents and surrounding or repeated spaces: they are stored trimmed with
--   single spaces, and compared through a stored key.
-- - Position: unique per list (per Área for Puesto), deferred so two items
--   can swap within one transaction. Every write that assigns a position
--   takes a transaction-scoped advisory lock for that list (and Área), so
--   two Admins never compute the same position or swap over each other.
-- - version: bumped on every change; the app sends the version it showed
--   and refuses a stale one (a concurrent change).
--
-- History: catalogo_eventos, written only by a trigger (SECURITY DEFINER)
-- with the acting user from auth.uid(). Changes without a user (this
-- migration's seed, the service role) are not recorded. Admin read only.

-- ---------------------------------------------------------------------------
-- Enums (stable codes; display labels live in the copy module)
-- ---------------------------------------------------------------------------
create type public.catalogo_lista as enum ('area', 'puesto', 'sucursal', 'convenio', 'tarea', 'categoria');

create type public.catalogo_accion as enum ('alta', 'renombre', 'reorden', 'desactivacion', 'reactivacion', 'baja');

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------
create table public.catalogo_items (
  id uuid primary key default gen_random_uuid(),
  lista public.catalogo_lista not null,
  nombre text not null,
  -- The comparison key: accents folded and lower case. Mirrored in
  -- src/lib/configuracion/nombre.ts (claveNombre).
  clave text generated always as (
    lower(translate(
      nombre,
      'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc'
    ))
  ) stored,
  -- Puesto only: its Área.
  area_id uuid,
  area_lista public.catalogo_lista generated always as (
    case when area_id is not null then 'area'::public.catalogo_lista end
  ) stored,
  -- Assigned on insert by catalogo_items_preparar_alta; the default only
  -- makes it optional for the caller.
  posicion integer not null default 0,
  activo boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint catalogo_items_id_lista_key unique (id, lista),
  constraint catalogo_items_id_area_key unique (id, area_id),
  constraint catalogo_items_area_fkey
    foreign key (area_id, area_lista) references public.catalogo_items (id, lista) on delete restrict,
  constraint catalogo_items_area_solo_puesto check ((lista = 'puesto') = (area_id is not null)),
  -- Trimmed, single spaces, 1 to 60 characters. Mirrored in nombre.ts.
  constraint catalogo_items_nombre_formato
    check (nombre = pg_catalog.btrim(pg_catalog.regexp_replace(nombre, '\s+', ' ', 'g')) and char_length(nombre) between 1 and 60),
  constraint catalogo_items_nombre_unico unique nulls not distinct (lista, area_id, clave),
  constraint catalogo_items_posicion_positiva check (posicion > 0),
  constraint catalogo_items_posicion_unica
    unique nulls not distinct (lista, area_id, posicion) deferrable initially deferred
);

create index catalogo_items_area_id_idx on public.catalogo_items (area_id);

alter table public.catalogo_items enable row level security;

-- anon: nothing. authenticated: the policies below limit every operation to
-- an active Admin. Columns: a new item names its list, Área and name (the
-- position is assigned); a change touches the name or the active flag. The
-- position changes only through mover_catalogo_item.
revoke all on table public.catalogo_items from anon, authenticated;
grant select, delete on table public.catalogo_items to authenticated;
grant insert (lista, area_id, nombre) on table public.catalogo_items to authenticated;
grant update (nombre, activo) on table public.catalogo_items to authenticated;

create policy catalogo_items_select_admin
  on public.catalogo_items
  for select
  to authenticated
  using ((select public.is_admin()));

create policy catalogo_items_insert_admin
  on public.catalogo_items
  for insert
  to authenticated
  with check ((select public.is_admin()));

create policy catalogo_items_update_admin
  on public.catalogo_items
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy catalogo_items_delete_admin
  on public.catalogo_items
  for delete
  to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Position and version
-- ---------------------------------------------------------------------------
-- A new item goes to the end of its list (or of its Área's Puestos), under
-- the list's lock. The lock is held until the transaction ends, so the next
-- writer reads this item's position once it is committed.
create function public.catalogo_items_preparar_alta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('catalogo_items:' || new.lista::text || ':' || coalesce(new.area_id::text, ''), 0)
  );
  select coalesce(max(i.posicion), 0) + 1 into new.posicion
  from public.catalogo_items as i
  where i.lista = new.lista and i.area_id is not distinct from new.area_id;
  new.version := 1;
  new.activo := coalesce(new.activo, true);
  return new;
end;
$$;

revoke execute on function public.catalogo_items_preparar_alta() from public, anon, authenticated;

create trigger catalogo_items_preparar_alta
  before insert on public.catalogo_items
  for each row
  execute function public.catalogo_items_preparar_alta();

-- A list or Área never changes; every change bumps the version.
create function public.catalogo_items_preparar_cambio()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lista is distinct from old.lista or new.area_id is distinct from old.area_id then
    raise exception 'An item cannot move to another list or Área' using errcode = '55000', hint = 'lista_fija';
  end if;
  new.version := old.version + 1;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke execute on function public.catalogo_items_preparar_cambio() from public, anon, authenticated;

create trigger catalogo_items_preparar_cambio
  before update on public.catalogo_items
  for each row
  execute function public.catalogo_items_preparar_cambio();

-- ---------------------------------------------------------------------------
-- History
-- ---------------------------------------------------------------------------
create table public.catalogo_eventos (
  id uuid primary key default gen_random_uuid(),
  -- Newest first, also for the two events of one move (same created_at).
  secuencia bigint generated always as identity,
  -- No foreign key: the history outlives a deleted item.
  item_id uuid not null,
  lista public.catalogo_lista not null,
  -- The item's name after the change (before it, for a deletion), and its
  -- Área's name for a Puesto, as they were then.
  item_nombre text not null,
  area_nombre text,
  accion public.catalogo_accion not null,
  -- renombre: names; reorden: positions; desactivacion and reactivacion:
  -- 'activo' / 'inactivo'; alta: nuevo only; baja: anterior only.
  valor_anterior text,
  valor_nuevo text,
  -- Deferred, as in cuenta_eventos. An Admin named here cannot be purged
  -- (purgar_cuenta, below).
  actor_id uuid not null references public.profiles (id) deferrable initially deferred,
  created_at timestamptz not null default now()
);

create index catalogo_eventos_secuencia_idx on public.catalogo_eventos (secuencia desc);
create index catalogo_eventos_actor_id_idx on public.catalogo_eventos (actor_id);

alter table public.catalogo_eventos enable row level security;

revoke all on table public.catalogo_eventos from anon, authenticated;
grant select on table public.catalogo_eventos to authenticated;

create policy catalogo_eventos_select_admin
  on public.catalogo_eventos
  for select
  to authenticated
  using ((select public.is_admin()));

-- INSERT, UPDATE, DELETE: no policy and no grant. Only the trigger writes.

-- SECURITY DEFINER: it writes history rows the API roles cannot. It only
-- records a change the table's policies already allowed, and takes nothing
-- from the caller but auth.uid().
create function public.registrar_catalogo_evento()
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
  end if;
  return null;
end;
$$;

revoke execute on function public.registrar_catalogo_evento() from public, anon, authenticated;

create trigger catalogo_items_registrar_evento
  after insert or update or delete on public.catalogo_items
  for each row
  execute function public.registrar_catalogo_evento();

-- ---------------------------------------------------------------------------
-- Reorder
-- ---------------------------------------------------------------------------
-- Moves an item one place up or down within its list (within its Área for a
-- Puesto), swapping positions with its neighbour. Under the list's lock, so
-- concurrent moves and additions run one at a time; p_version is the
-- version the Admin saw, so a move based on a stale screen is refused.
-- Error codes: 42501 not allowed; 22023 bad direction; P0002 item not
-- found; 55000 with HINT version (changed meanwhile) or extremo (already
-- first or last).
create function public.mover_catalogo_item(p_item_id uuid, p_version integer, p_direccion text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.catalogo_items;
  vecino public.catalogo_items;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reorder lists' using errcode = '42501';
  end if;
  if p_direccion is null or p_direccion not in ('arriba', 'abajo') then
    raise exception 'Direction must be arriba or abajo' using errcode = '22023';
  end if;

  select * into item from public.catalogo_items where id = p_item_id;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('catalogo_items:' || item.lista::text || ':' || coalesce(item.area_id::text, ''), 0)
  );

  -- Read again under the lock: a move or a deletion may have committed.
  select * into item from public.catalogo_items where id = p_item_id for update;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  if item.version is distinct from p_version then
    raise exception 'The item changed meanwhile' using errcode = '55000', hint = 'version';
  end if;

  if p_direccion = 'arriba' then
    select * into vecino from public.catalogo_items as i
    where i.lista = item.lista and i.area_id is not distinct from item.area_id and i.posicion < item.posicion
    order by i.posicion desc
    limit 1
    for update;
  else
    select * into vecino from public.catalogo_items as i
    where i.lista = item.lista and i.area_id is not distinct from item.area_id and i.posicion > item.posicion
    order by i.posicion
    limit 1
    for update;
  end if;
  if not found then
    raise exception 'The item is already at that end' using errcode = '55000', hint = 'extremo';
  end if;

  -- The position constraint is deferred: the swap is checked at commit.
  update public.catalogo_items set posicion = vecino.posicion where id = item.id;
  update public.catalogo_items set posicion = item.posicion where id = vecino.id;
end;
$$;

revoke execute on function public.mover_catalogo_item(uuid, integer, text) from public, anon;
grant execute on function public.mover_catalogo_item(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Purge: an Admin named in the lists' history stays
-- ---------------------------------------------------------------------------
-- As in F1-07A, plus one more history that names the account:
-- catalogo_eventos (its actor_id would otherwise block the delete with a
-- foreign-key error instead of the controlled refusal).
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

  -- Other accounts' history, or the lists' history, names this account: it must stay.
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

-- ---------------------------------------------------------------------------
-- Initial values (idempotent: an item that already exists is skipped)
-- ---------------------------------------------------------------------------
-- One insert per item, in order, so each gets the next position. No user is
-- signed in here, so the history records nothing.
do $$
declare
  listas constant jsonb := '[
    ["area", ["Ventas", "Administración", "Logística", "Gerencia"]],
    ["sucursal", ["Casa Central", "San Martín", "Pacheco", "San Justo"]],
    ["convenio", ["Comercio"]],
    ["tarea", ["Administrativo", "Ventas", "Maestranza y Servicios", "Cajero"]],
    ["categoria", ["A", "B", "C", "D", "E", "F"]]
  ]';
  puestos constant jsonb := '[
    ["Ventas", ["Cuentas corrientes", "Mostrador (SM)", "Mostrador (PA)", "Mostrador (SJ)"]],
    ["Administración", ["Cobranzas", "Proveedores", "Otros"]],
    ["Logística", ["Depósito", "Distribución"]],
    ["Gerencia", ["Gerencia"]]
  ]';
  v_lista jsonb;
  v_nombre text;
  v_area uuid;
begin
  for v_lista in select value from jsonb_array_elements(listas) loop
    for v_nombre in select value from jsonb_array_elements_text(v_lista -> 1) with ordinality as x(value, n) order by n loop
      if not exists (
        select 1 from public.catalogo_items as i
        where i.lista = (v_lista ->> 0)::public.catalogo_lista and i.area_id is null and i.nombre = v_nombre
      ) then
        insert into public.catalogo_items (lista, nombre) values ((v_lista ->> 0)::public.catalogo_lista, v_nombre);
      end if;
    end loop;
  end loop;

  for v_lista in select value from jsonb_array_elements(puestos) loop
    select i.id into v_area from public.catalogo_items as i where i.lista = 'area' and i.nombre = v_lista ->> 0;
    for v_nombre in select value from jsonb_array_elements_text(v_lista -> 1) with ordinality as x(value, n) order by n loop
      if not exists (
        select 1 from public.catalogo_items as i
        where i.lista = 'puesto' and i.area_id = v_area and i.nombre = v_nombre
      ) then
        insert into public.catalogo_items (lista, area_id, nombre) values ('puesto', v_area, v_nombre);
      end if;
    end loop;
  end loop;
end;
$$;
