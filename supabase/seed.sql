-- LOCAL AND CI ONLY. TEST DATA. Never run against the remote project.
-- Creates one Admin, two active Empleado and one inactive Empleado test users
-- with local-only credentials.
-- Emails use the reserved `.test` TLD; passwords are test values, not secrets.
-- See README.md, "Local test users".

-- Auth users. The on_auth_user_created trigger creates each profile as 'empleado'.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('TestPass123!', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
from (
  values
    ('00000000-0000-4000-a000-000000000001'::uuid, 'admin@mitsm.test'),
    ('00000000-0000-4000-a000-000000000002'::uuid, 'empleado.a@mitsm.test'),
    ('00000000-0000-4000-a000-000000000003'::uuid, 'empleado.b@mitsm.test'),
    ('00000000-0000-4000-a000-000000000004'::uuid, 'empleado.inactivo@mitsm.test')
) as u (id, email);

-- Email identities, required for email + password sign-in.
insert into auth.identities (
  id,
  user_id,
  provider_id,
  provider,
  identity_data,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  u.id,
  u.id::text,
  'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(),
  now(),
  now()
from auth.users as u
where u.email in (
  'admin@mitsm.test',
  'empleado.a@mitsm.test',
  'empleado.b@mitsm.test',
  'empleado.inactivo@mitsm.test'
);

-- Promote the Admin test user. The trigger never creates admins.
update public.profiles
set role = 'admin'
where id = '00000000-0000-4000-a000-000000000001';

-- Empleado B has a temporary password: the forced change runs at login.
update public.profiles
set debe_cambiar_password = true
where id = '00000000-0000-4000-a000-000000000003';

-- The inactive Empleado: deactivated by the Admin, and banned in Auth as the
-- deactivation does (100 years stands for "until reactivated").
update public.profiles
set estado_cuenta = 'inactiva'
where id = '00000000-0000-4000-a000-000000000004';

update auth.users
set banned_until = now() + interval '100 years'
where id = '00000000-0000-4000-a000-000000000004';

insert into public.cuenta_eventos (profile_id, tipo, motivo, actor_id, created_at)
values (
  '00000000-0000-4000-a000-000000000004',
  'desactivacion',
  'Baja de prueba: fin del contrato ficticio.',
  '00000000-0000-4000-a000-000000000001',
  now() - interval '3 days'
);

-- Legajos. The on_profile_created_create_legajo trigger already created an
-- empty legajo per profile; fill them with clearly fictional test data.
update public.legajos
set
  nombres = 'Prueba Admin',
  apellido = 'Ficticio',
  dni = '90000001',
  nacionalidad = 'Argentina',
  cuil = '20900000011',
  fecha_nacimiento = '1980-03-15',
  calle_altura = 'Calle Falsa 123',
  piso_depto = null,
  localidad = 'Villa Ficticia',
  partido = 'General San Martín',
  partido_otro = null,
  telefono_celular = '1100000001',
  email_personal = 'admin.personal@example.test',
  estado_civil = 'casado',
  nombre_conyuge = 'Cónyuge Ficticio Uno',
  tiene_hijos = false,
  grupo_sanguineo = '0+',
  alergias = 'Ninguna',
  medicacion_habitual = 'Ninguna',
  obra_social = 'Obra Social de Prueba',
  numero_afiliado = 'TEST-0001',
  emergencia_nombre = 'Contacto Ficticio Uno',
  emergencia_parentesco = 'Cónyuge',
  emergencia_domicilio = 'Calle Falsa 123, Villa Ficticia',
  emergencia_telefono = '1100000101',
  numero_legajo = 'TEST-001',
  area = 'Administración',
  puesto = 'Responsable de RR. HH. (prueba)',
  fecha_ingreso = '2015-02-01',
  estado_laboral = 'activo',
  sede = 'Sede de Prueba',
  modalidad = 'Presencial',
  convenio = 'Convenio de Prueba',
  bruto_mensual = 1500000.00
where profile_id = '00000000-0000-4000-a000-000000000001';

update public.legajos
set
  nombres = 'Prueba Empleado A',
  apellido = 'Ficticio',
  dni = '90000002',
  nacionalidad = 'Argentina',
  cuil = '27900000022',
  fecha_nacimiento = '1990-07-01',
  calle_altura = 'Avenida Inventada 456',
  piso_depto = '3° B',
  localidad = 'Barrio de Prueba',
  partido = 'Otro',
  partido_otro = 'Partido Ficticio',
  telefono_celular = '1100000002',
  email_personal = 'empleado.a.personal@example.test',
  estado_civil = 'union_convivencial',
  nombre_conyuge = 'Conviviente Ficticio Dos',
  tiene_hijos = true,
  grupo_sanguineo = 'A+',
  alergias = 'Polen (dato de prueba)',
  medicacion_habitual = 'Ninguna',
  obra_social = 'Prepaga de Prueba',
  numero_afiliado = 'TEST-0002',
  emergencia_nombre = 'Contacto Ficticio Dos',
  emergencia_parentesco = 'Hermana',
  emergencia_domicilio = 'Avenida Inventada 789, Barrio de Prueba',
  emergencia_telefono = '1100000102',
  numero_legajo = 'TEST-002',
  area = 'Operaciones',
  puesto = 'Técnico (prueba)',
  fecha_ingreso = '2021-09-15',
  estado_laboral = 'activo',
  sede = 'Sede de Prueba',
  modalidad = 'Híbrida',
  convenio = 'Convenio de Prueba',
  bruto_mensual = 950000.00
where profile_id = '00000000-0000-4000-a000-000000000002';

update public.legajos
set
  nombres = 'Prueba Empleado B',
  apellido = 'Ficticio',
  dni = '90000003',
  nacionalidad = 'Argentina',
  cuil = '20900000033',
  fecha_nacimiento = '1995-11-20',
  calle_altura = 'Pasaje Imaginario 10',
  piso_depto = null,
  localidad = 'Localidad de Prueba',
  partido = 'Tigre',
  partido_otro = null,
  telefono_celular = '1100000003',
  email_personal = 'empleado.b.personal@example.test',
  estado_civil = 'soltero',
  nombre_conyuge = null,
  tiene_hijos = false,
  grupo_sanguineo = 'B-',
  alergias = 'Ninguna',
  medicacion_habitual = 'Ninguna',
  obra_social = 'Obra Social de Prueba',
  numero_afiliado = 'TEST-0003',
  emergencia_nombre = 'Contacto Ficticio Tres',
  emergencia_parentesco = 'Padre',
  emergencia_domicilio = 'Pasaje Imaginario 12, Localidad de Prueba',
  emergencia_telefono = '1100000103',
  numero_legajo = 'TEST-003',
  area = 'Logística',
  puesto = 'Operario (prueba)',
  fecha_ingreso = '2025-06-02',
  estado_laboral = 'en_prueba',
  sede = 'Sede de Prueba',
  modalidad = 'Presencial',
  convenio = 'Convenio de Prueba',
  bruto_mensual = 720000.00
where profile_id = '00000000-0000-4000-a000-000000000003';

update public.legajos
set
  nombres = 'Prueba Empleado Inactivo',
  apellido = 'Ficticio',
  dni = '90000004'
where profile_id = '00000000-0000-4000-a000-000000000004';

-- Children for Empleado A only (Admin and Empleado B have none).
insert into public.legajo_hijos (legajo_id, nombre_completo, fecha_nacimiento)
select l.id, h.nombre_completo, h.fecha_nacimiento
from public.legajos as l
cross join (
  values
    ('Hijo Ficticio Uno', '2015-04-10'::date),
    ('Hija Ficticia Dos', '2019-12-05'::date)
) as h (nombre_completo, fecha_nacimiento)
where l.profile_id = '00000000-0000-4000-a000-000000000002';

-- Legajo documents. The files are tiny fake PDFs in supabase/seed/legajo-docs,
-- uploaded to the local legajo-docs bucket by the CLI (config.toml,
-- storage.buckets.legajo-docs). size_bytes matches each file.
-- Empleado A: DNI frente and dorso, approved by the Admin.
insert into public.legajo_documentos (
  legajo_id, tipo, storage_path, file_name, mime_type, size_bytes, uploaded_by,
  estado, revisado_por, revisado_en
)
select
  l.id,
  d.tipo::public.documento_tipo,
  d.storage_path,
  d.file_name,
  'application/pdf',
  d.size_bytes,
  l.profile_id,
  'aprobado',
  '00000000-0000-4000-a000-000000000001',
  now()
from public.legajos as l
cross join (
  values
    (
      'dni_frente',
      '00000000-0000-4000-a000-000000000002/dni_frente/00000000-0000-4000-b000-000000000001.pdf',
      'dni-frente-prueba.pdf',
      78
    ),
    (
      'dni_dorso',
      '00000000-0000-4000-a000-000000000002/dni_dorso/00000000-0000-4000-b000-000000000002.pdf',
      'dni-dorso-prueba.pdf',
      77
    )
) as d (tipo, storage_path, file_name, size_bytes)
where l.profile_id = '00000000-0000-4000-a000-000000000002';

-- Empleado B: one pending licencia de conducir, waiting for Admin review.
insert into public.legajo_documentos (
  legajo_id, tipo, storage_path, file_name, mime_type, size_bytes, uploaded_by, estado
)
select
  l.id,
  'licencia_conducir',
  '00000000-0000-4000-a000-000000000003/licencia_conducir/00000000-0000-4000-b000-000000000003.pdf',
  'licencia-prueba.pdf',
  'application/pdf',
  75,
  l.profile_id,
  'pendiente'
from public.legajos as l
where l.profile_id = '00000000-0000-4000-a000-000000000003';

-- Change requests for Empleado A. valor_anterior is filled by the
-- solicitudes_cambio_items trigger from the current legajo.
-- 1. Rejected by the Admin, with a reason (history).
insert into public.solicitudes_cambio (
  id, legajo_id, solicitado_por, estado, motivo_rechazo, revisado_por, revisado_en, created_at
)
select
  '00000000-0000-4000-c000-000000000001',
  l.id,
  l.profile_id,
  'rechazada',
  'El apellido no coincide con el DNI (dato de prueba).',
  '00000000-0000-4000-a000-000000000001',
  now() - interval '1 day',
  now() - interval '2 days'
from public.legajos as l
where l.profile_id = '00000000-0000-4000-a000-000000000002';

insert into public.solicitudes_cambio_items (solicitud_id, campo, valor_propuesto)
values ('00000000-0000-4000-c000-000000000001', 'apellido', 'Ficticio Rechazado');

-- 2. Pending, with two fields.
insert into public.solicitudes_cambio (id, legajo_id, solicitado_por, estado)
select
  '00000000-0000-4000-c000-000000000002',
  l.id,
  l.profile_id,
  'pendiente'
from public.legajos as l
where l.profile_id = '00000000-0000-4000-a000-000000000002';

insert into public.solicitudes_cambio_items (solicitud_id, campo, valor_propuesto)
values
  ('00000000-0000-4000-c000-000000000002', 'telefono_celular', '1100000022'),
  ('00000000-0000-4000-c000-000000000002', 'alergias', 'Polen y ácaros (dato de prueba)');
