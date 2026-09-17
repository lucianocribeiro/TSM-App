# PRD Fase 1 — Legajo del Empleado
Version: 0.2 (draft) | Governed by: `docs/constitucion.md`

## 1. Objective
Deliver the Legajo module plus the auth, roles and data-isolation foundation that Fases 2 and 3 rely on, deployed to production.

## 2. Scope
1. Foundation: repo bootstrap, CI, `CLAUDE.md`, skills, Constitution and PRD.
2. Auth: email + password login, logout, session protection, role-based route guards.
3. Roles and profiles: one profile per auth user, role Empleado or Admin.
4. User management: Admin creates employee accounts and assigns roles.
5. Legajo: personal, contact, family, emergency and work data per employee (section 5), with role-based edit permissions.
6. Legajo documents: upload, list and download from a private bucket. Types: DNI (frente y dorso), required; Licencia de conducir, optional.
7. App shell: login screen, layout, sidebar menu, logo top left, light and dark modes, TSM palette, centralized es-AR copy.
8. Production deploy on Vercel with the real domain.
9. E2E, role-boundary and RLS tests.

## 3. User stories and acceptance criteria

### US-1 Login
As a user, I log in with email and password.
- Invalid credentials show an es-AR error message.
- Unauthenticated users are redirected to login from any protected route.
- Logout ends the session and returns to login.

### US-2 Role boundaries
As the system, I restrict every view and every row by role.
- An Empleado cannot open Admin routes (redirected).
- RLS tests prove an Empleado cannot read or write another employee's rows or files.

### US-3 Mi Legajo
As an Empleado, I see my legajo and edit my personal data (groups A to D in section 5).
- Work data (group E) is read-only for Empleado, enforced in RLS and in the Server Action.
- Required fields and validation rules from section 5 are enforced.
- I can view and download my own documents.

### US-4 Legajos (Admin)
As Admin, I see the list of employees and open any legajo.
- I can edit all legajo data (groups A to E).
- I can upload documents to any employee's legajo; files go to a private bucket.
- The Legajos list shows a KPI strip with legajo-based numbers only (no licencias or recibos metrics in Fase 1).

### US-5 User management
As Admin, I create an employee account and assign a role.
- The new user can log in and sees only their own legajo.

### US-6 Branding, theme and copy
- The TSM logo (`public/logotsm.png`) is the only element at the top of the sidebar.
- The TSM palette and typography from the prototype are applied.
- Every screen works in light and dark mode; the user switches with a manual toggle.
- All UI text comes from the es-AR copy module.

### US-7 Production
- The portal runs on Vercel under the real domain.
- Supabase Auth redirect URLs match the production domain.

## 4. Out of scope
- Recibos de sueldo and signature (Fase 2).
- Licencias, ausencias, comunicados and notifications (Fase 3).
- Production hardening, backups, retention policy, DB sizing (Fase 3).
- Magic link, OAuth, SSO.

## 5. Legajo fields
Source: TSM validated employee update form ("Formulario de actualización - Tecno San Martin"). Labels, required flags and options are used as-is. `*` = required.

### 5.1 Datos personales (group A)
- Nombres*
- Apellido*
- DNI* (digits only, no dots or spaces)
- Nacionalidad*
- CUIL*
- Fecha de nacimiento*

### 5.2 Domicilio y contacto (group B)
- Calle y altura*
- Piso y departamento
- Localidad*
- Partido* — options: General San Martín, CABA, Almirante Brown, Avellaneda, Berazategui, Berisso, Brandsen, Campana, Cañuelas, Ensenada, Escobar, Esteban Echeverría, Exaltación de la Cruz, Ezeiza, Florencio Varela, General Las Heras, General Rodríguez, Hurlingham, Ituzaingó, José C. Paz, La Matanza, La Plata, Lanús, Lomas de Zamora, Luján, Malvinas Argentinas, Marcos Paz, Merlo, Moreno, Morón, Pilar, Presidente Perón, Quilmes, San Fernando, San Isidro, San Miguel, San Vicente, Tigre, Tres de Febrero, Vicente López, Zárate, Otro
- Partido (otro)* — free text, shown and required only when Partido = Otro
- Teléfono celular personal*
- Correo electrónico personal* — separate from the login email

### 5.3 Datos familiares (group C)
- Estado civil* — options: Soltero, Casado, Divorciado, Viudo, Unión Convivencial
- Nombre completo cónyuge / concubino
- Tiene hijos* — Sí / No
- Hijos — any number of children; each child has Nombre completo* and Fecha de nacimiento*. At least one child is required when Tiene hijos = Sí; none allowed when No.

### 5.4 Datos de emergencia (group D)
- Grupo sanguíneo*
- Alergias*
- Medicación habitual*
- Obra social / prepaga*
- Número de afiliado*
- Nombre completo de contacto de emergencia*
- Relación de parentesco contacto de emergencia*
- Domicilio completo contacto de emergencia*
- Teléfono de contacto de emergencia*

### 5.5 Datos laborales (group E)
- Número de legajo*
- Área*
- Puesto*
- Fecha de ingreso*
- Antigüedad — calculated from Fecha de ingreso, not stored
- Estado* — options: Activo, En prueba ("En licencia" is added with the Licencias module in Fase 3)
- Sede*
- Modalidad*
- Convenio*
- Bruto mensual*

### 5.6 Edit permissions
| Group | Empleado (own legajo only) | Admin (any legajo) |
|---|---|---|
| A to D | Read and edit | Read and edit |
| E (laborales, including Bruto mensual) | Read only | Read and edit |

Validation (required fields, DNI digits only, Partido otro, children rule) is enforced on the server, not only in the form.

## 6. Open decisions
| # | Decision | Needed before |
|---|---|---|
| 1 | How a new employee gets the first password | F1-07 |
| 2 | Real domain and DNS | F1-12 |

## 7. Definition of Done
- All CI jobs green.
- Role-boundary tests pass.
- RLS and access tested per table and per storage bucket.
- es-AR copy centralized; light and dark modes verified on new screens.
- No secrets committed.
- Types regenerated after migrations.
- Codex audit clean (blocking findings resolved).
- Migrations applied through the `db push` runbook with Local = Remote confirmed.
- Repo state checked before merge.
