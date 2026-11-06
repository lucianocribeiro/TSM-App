-- F2-02: receipts schema and RLS (PRD Fase 2 v0.4, Constitution §11 v0.10).
--
-- Periods with their state log, one receipt per employee per period, the
-- Admin-only history of replaced receipts and of DNI-check overrides, the
-- employees' registered signatures (versioned) and the signature evidence.
--
-- Access: every table is read only for the API roles. An active Admin reads
-- every row; an active Empleado reads their own receipts, signatures and
-- evidence, and the periods, only once a period is no longer a draft. anon
-- reaches nothing. There is no INSERT, UPDATE or DELETE grant or policy for
-- any API role: the writes come with the SECURITY DEFINER functions of F2-04
-- and F2-05.
--
-- Retention: every foreign key to public.profiles is ON DELETE RESTRICT, so
-- an account with any receipt, signature or evidence row cannot be removed
-- (the account purge is refused) until a retention rule exists (Fase 3).
-- Evidence and logs are append-only, for every role, the service role
-- included (guard triggers below).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.recibo_periodo_estado as enum ('borrador', 'publicado', 'cerrado');
create type public.recibo_periodo_accion as enum ('creado', 'publicado', 'cerrado', 'reabierto');
create type public.recibo_estado as enum ('pendiente', 'firmado');
create type public.recibo_override_motivo as enum ('dni_no_encontrado', 'no_verificable', 'sin_dni');

-- ---------------------------------------------------------------------------
-- Periods
-- ---------------------------------------------------------------------------
-- One row per month. Employees see nothing of a draft (borrador).
create table public.recibo_periodos (
  id uuid primary key default gen_random_uuid(),
  anio integer not null,
  mes integer not null,
  estado public.recibo_periodo_estado not null default 'borrador',
  publicado_at timestamptz,
  publicado_por uuid references public.profiles (id) on delete restrict,
  cerrado_at timestamptz,
  cerrado_por uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id) on delete restrict,

  constraint recibo_periodos_anio check (anio between 2000 and 2100),
  constraint recibo_periodos_mes check (mes between 1 and 12),
  constraint recibo_periodos_anio_mes_key unique (anio, mes),
  -- Published (and closed) periods were published at some point.
  constraint recibo_periodos_publicado check (estado = 'borrador' or publicado_at is not null),
  constraint recibo_periodos_cerrado check (estado <> 'cerrado' or cerrado_at is not null)
);

-- Append-only log of the period states: who created, published, closed or
-- re-opened it, and when.
create table public.recibo_periodo_historial (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references public.recibo_periodos (id) on delete restrict,
  accion public.recibo_periodo_accion not null,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index recibo_periodo_historial_periodo_id_idx on public.recibo_periodo_historial (periodo_id);

-- ---------------------------------------------------------------------------
-- Registered signatures
-- ---------------------------------------------------------------------------
-- Versioned per employee; redrawing adds a version and deactivates the
-- previous one, which is kept as evidence. imagen_path is the object path in
-- the F2-03 storage (no bucket yet).
create table public.firmas_empleado (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references public.profiles (id) on delete restrict,
  version integer not null,
  imagen_path text not null,
  activa boolean not null,
  created_at timestamptz not null default now(),

  constraint firmas_empleado_version check (version >= 1),
  -- Also the index of the signatures by employee.
  constraint firmas_empleado_empleado_version_key unique (empleado_id, version),
  -- Target of the composite foreign keys that tie a signature to its owner.
  constraint firmas_empleado_id_empleado_key unique (id, empleado_id)
);

-- At most one active signature per employee.
create unique index firmas_empleado_una_activa_idx on public.firmas_empleado (empleado_id) where activa;

-- ---------------------------------------------------------------------------
-- Receipts
-- ---------------------------------------------------------------------------
-- The current receipt of an employee in a period. archivo_path is the object
-- path in the F2-03 bucket (no bucket yet); the signed PDF replaces the
-- unsigned one at the same row. A signed receipt names the signature used,
-- which must be the employee's own (composite foreign key).
create table public.recibos (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references public.recibo_periodos (id) on delete restrict,
  empleado_id uuid not null references public.profiles (id) on delete restrict,
  archivo_path text not null,
  archivo_bytes integer not null,
  estado public.recibo_estado not null default 'pendiente',
  cargado_por uuid not null references public.profiles (id) on delete restrict,
  cargado_at timestamptz not null default now(),
  firmado_at timestamptz,
  firma_id uuid,
  updated_at timestamptz not null default now(),

  -- One receipt per employee per period; also the index by period.
  constraint recibos_periodo_empleado_key unique (periodo_id, empleado_id),
  -- Target of the composite foreign key of the signature evidence.
  constraint recibos_id_empleado_key unique (id, empleado_id),
  constraint recibos_archivo_bytes check (archivo_bytes > 0),
  constraint recibos_firma_fkey
    foreign key (firma_id, empleado_id) references public.firmas_empleado (id, empleado_id) on delete restrict,
  -- Signed exactly when it has the signature date and the signature used.
  constraint recibos_firmado check (
    (estado = 'firmado' and firmado_at is not null and firma_id is not null)
    or (estado = 'pendiente' and firmado_at is null and firma_id is null)
  )
);

create index recibos_empleado_id_idx on public.recibos (empleado_id);
create index recibos_estado_periodo_id_idx on public.recibos (estado, periodo_id);

-- Replaced receipts, Admin only: the previous file and, if it was signed, its
-- signature record, copied as they were. Append-only.
create table public.recibo_historial (
  id uuid primary key default gen_random_uuid(),
  recibo_id uuid not null references public.recibos (id) on delete restrict,
  periodo_id uuid not null references public.recibo_periodos (id) on delete restrict,
  empleado_id uuid not null references public.profiles (id) on delete restrict,
  archivo_path text not null,
  archivo_bytes integer not null,
  estado_al_reemplazo public.recibo_estado not null,
  firmado_at timestamptz,
  firma_id uuid references public.firmas_empleado (id) on delete restrict,
  cargado_por uuid not null references public.profiles (id) on delete restrict,
  cargado_at timestamptz not null,
  reemplazado_por uuid not null references public.profiles (id) on delete restrict,
  reemplazado_at timestamptz not null default now(),

  constraint recibo_historial_archivo_bytes check (archivo_bytes > 0),
  constraint recibo_historial_firmado check (
    (estado_al_reemplazo = 'firmado' and firmado_at is not null and firma_id is not null)
    or (estado_al_reemplazo = 'pendiente' and firmado_at is null and firma_id is null)
  )
);

create index recibo_historial_recibo_id_idx on public.recibo_historial (recibo_id);

-- Every Admin "Aceptar" after a failed or impossible DNI check, with the file
-- it applied to. Admin only, append-only.
create table public.recibo_overrides (
  id uuid primary key default gen_random_uuid(),
  recibo_id uuid not null references public.recibos (id) on delete restrict,
  motivo public.recibo_override_motivo not null,
  archivo_path text not null,
  admin_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index recibo_overrides_recibo_id_idx on public.recibo_overrides (recibo_id);

-- ---------------------------------------------------------------------------
-- Signature evidence
-- ---------------------------------------------------------------------------
-- Who signed which receipt, when, with which signature version. Immutable.
-- The signer is the receipt's employee and the signature's owner: both
-- composite foreign keys share empleado_id.
create table public.recibo_firmas (
  id uuid primary key default gen_random_uuid(),
  recibo_id uuid not null,
  empleado_id uuid not null references public.profiles (id) on delete restrict,
  firma_id uuid not null,
  firmado_at timestamptz not null default now(),

  constraint recibo_firmas_recibo_fkey
    foreign key (recibo_id, empleado_id) references public.recibos (id, empleado_id) on delete restrict,
  constraint recibo_firmas_firma_fkey
    foreign key (firma_id, empleado_id) references public.firmas_empleado (id, empleado_id) on delete restrict
);

create index recibo_firmas_recibo_id_idx on public.recibo_firmas (recibo_id);
create index recibo_firmas_empleado_id_idx on public.recibo_firmas (empleado_id);

-- ---------------------------------------------------------------------------
-- Guard triggers
-- ---------------------------------------------------------------------------
-- Append-only tables: no UPDATE or DELETE for any role, the service role and
-- SECURITY DEFINER callers included (a row trigger runs for all of them).
create function public.recibos_solo_agregar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Rows of % cannot be changed or deleted', tg_table_name
    using errcode = '55000', hint = 'registro_inmutable';
end;
$$;

revoke execute on function public.recibos_solo_agregar() from public, anon, authenticated;

create trigger recibo_firmas_solo_agregar
  before update or delete on public.recibo_firmas
  for each row
  execute function public.recibos_solo_agregar();

create trigger recibo_periodo_historial_solo_agregar
  before update or delete on public.recibo_periodo_historial
  for each row
  execute function public.recibos_solo_agregar();

create trigger recibo_historial_solo_agregar
  before update or delete on public.recibo_historial
  for each row
  execute function public.recibos_solo_agregar();

create trigger recibo_overrides_solo_agregar
  before update or delete on public.recibo_overrides
  for each row
  execute function public.recibos_solo_agregar();

-- Registered signatures are never deleted, and the only change is retiring
-- the active one (activa true -> false); the image and the version never
-- change.
create function public.firmas_empleado_proteger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A registered signature cannot be deleted'
      using errcode = '55000', hint = 'registro_inmutable';
  end if;
  if old.activa and not new.activa
    and new.id = old.id
    and new.empleado_id = old.empleado_id
    and new.version = old.version
    and new.imagen_path = old.imagen_path
    and new.created_at = old.created_at
  then
    return new;
  end if;
  raise exception 'A registered signature can only be retired'
    using errcode = '55000', hint = 'firma_inmutable';
end;
$$;

revoke execute on function public.firmas_empleado_proteger() from public, anon, authenticated;

create trigger firmas_empleado_proteger
  before update or delete on public.firmas_empleado
  for each row
  execute function public.firmas_empleado_proteger();

-- A signed receipt does not go back to pending.
-- TODO(F2-04): the replacement function moves a signed receipt to the history
-- and resets it to pendiente with the new file; its migration adjusts this
-- trigger for that path.
create function public.recibos_proteger_firmado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado = 'firmado'::public.recibo_estado and new.estado = 'pendiente'::public.recibo_estado then
    raise exception 'A signed receipt cannot go back to pending'
      using errcode = '55000', hint = 'recibo_firmado';
  end if;
  return new;
end;
$$;

revoke execute on function public.recibos_proteger_firmado() from public, anon, authenticated;

create trigger recibos_proteger_firmado
  before update on public.recibos
  for each row
  execute function public.recibos_proteger_firmado();

create trigger recibos_set_updated_at
  before update on public.recibos
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.recibo_periodos enable row level security;
alter table public.recibo_periodo_historial enable row level security;
alter table public.firmas_empleado enable row level security;
alter table public.recibos enable row level security;
alter table public.recibo_historial enable row level security;
alter table public.recibo_overrides enable row level security;
alter table public.recibo_firmas enable row level security;

-- SELECT only, for authenticated; nothing for anon. No INSERT, UPDATE or
-- DELETE grant and no write policy for any API role.
revoke all on table public.recibo_periodos from anon, authenticated;
revoke all on table public.recibo_periodo_historial from anon, authenticated;
revoke all on table public.firmas_empleado from anon, authenticated;
revoke all on table public.recibos from anon, authenticated;
revoke all on table public.recibo_historial from anon, authenticated;
revoke all on table public.recibo_overrides from anon, authenticated;
revoke all on table public.recibo_firmas from anon, authenticated;

grant select on table public.recibo_periodos to authenticated;
grant select on table public.recibo_periodo_historial to authenticated;
grant select on table public.firmas_empleado to authenticated;
grant select on table public.recibos to authenticated;
grant select on table public.recibo_historial to authenticated;
grant select on table public.recibo_overrides to authenticated;
grant select on table public.recibo_firmas to authenticated;

-- is_admin() and cuenta_activa() are true only for an active account
-- (F1-11A), so an inactive caller reads nothing.

-- Periods: every period for an Admin; an Empleado only once it is published.
create policy recibo_periodos_select_admin_o_publicado
  on public.recibo_periodos
  for select
  to authenticated
  using (
    (select public.is_admin())
    or ((select public.cuenta_activa()) and estado <> 'borrador'::public.recibo_periodo_estado)
  );

-- Admin only.
create policy recibo_periodo_historial_select_admin
  on public.recibo_periodo_historial
  for select
  to authenticated
  using ((select public.is_admin()));

-- Own receipts in a non-draft period. The period is read under its own
-- policy, which never reads recibos: no recursion, and a draft period stays
-- out of reach for an Empleado either way.
create policy recibos_select_propio_o_admin
  on public.recibos
  for select
  to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.cuenta_activa())
      and empleado_id = (select auth.uid())
      and exists (
        select 1 from public.recibo_periodos as p
        where p.id = periodo_id and p.estado <> 'borrador'::public.recibo_periodo_estado
      )
    )
  );

-- Admin only.
create policy recibo_historial_select_admin
  on public.recibo_historial
  for select
  to authenticated
  using ((select public.is_admin()));

-- Admin only.
create policy recibo_overrides_select_admin
  on public.recibo_overrides
  for select
  to authenticated
  using ((select public.is_admin()));

-- Own signatures, every version.
create policy firmas_empleado_select_propio_o_admin
  on public.firmas_empleado
  for select
  to authenticated
  using (
    (select public.is_admin())
    or ((select public.cuenta_activa()) and empleado_id = (select auth.uid()))
  );

-- Own signature evidence.
create policy recibo_firmas_select_propio_o_admin
  on public.recibo_firmas
  for select
  to authenticated
  using (
    (select public.is_admin())
    or ((select public.cuenta_activa()) and empleado_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Employee counter (PRD RF-23)
-- ---------------------------------------------------------------------------
-- The caller's own pending receipts in non-draft periods, for the "Mis
-- Recibos" counter (F2-05). SECURITY INVOKER: RLS applies, so an inactive
-- caller gets 0.
create function public.mis_recibos_pendientes_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.count(*)::integer
  from public.recibos as r
  join public.recibo_periodos as p on p.id = r.periodo_id
  where r.empleado_id = (select auth.uid())
    and r.estado = 'pendiente'::public.recibo_estado
    and p.estado <> 'borrador'::public.recibo_periodo_estado;
$$;

revoke execute on function public.mis_recibos_pendientes_count() from public, anon;
grant execute on function public.mis_recibos_pendientes_count() to authenticated;
