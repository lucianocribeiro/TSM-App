-- LOCAL AND CI ONLY. TEST DATA. Never run against the remote project.
-- Creates one Admin and two Empleado test users with local-only credentials.
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
    ('00000000-0000-4000-a000-000000000003'::uuid, 'empleado.b@mitsm.test')
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
where u.email in ('admin@mitsm.test', 'empleado.a@mitsm.test', 'empleado.b@mitsm.test');

-- Promote the Admin test user. The trigger never creates admins.
update public.profiles
set role = 'admin'
where id = '00000000-0000-4000-a000-000000000001';

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
