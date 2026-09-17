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
