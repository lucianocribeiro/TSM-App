# PRD Fase 1 — Legajo del Empleado
Version: 0.5 (draft) | Governed by: `docs/constitucion.md`
Change log: v0.5 — CUIL accepts only the prefixes 20, 23, 24 and 27 (5.7).

## 1. Objective
Deliver the Legajo module plus the auth, roles and data-isolation foundation that Fases 2 and 3 rely on, deployed to production.

## 2. Scope
1. Foundation: repo bootstrap, CI, `CLAUDE.md`, skills, Constitution and PRD.
2. Auth: email + password login, logout, session protection, role-based route guards.
3. Roles and profiles: one profile per auth user, role Empleado or Admin.
4. User management: Admin creates employee accounts and assigns roles.
5. Legajo: personal, contact, family, emergency and work data per employee (section 5), with role-based edit permissions.
6. Legajo documents: upload, list and download from a private bucket. Types: DNI (frente y dorso), required; Licencia de conducir, optional.
7. App shell: login screen, layout, sidebar menu, TSM logo at the top of the sidebar, light and dark modes, TSM palette, centralized es-AR copy.
8. Production deploy on Vercel with the real domain.
9. E2E, role-boundary and RLS tests.
10. Approval flow: personal data changes (groups A to D) and document uploads made by an Empleado require Admin approval before they take effect. Rejections carry a reason.
11. Estado de la cuenta (Activa / Inactiva): Admin deactivates an account with a reason instead of deleting it; deactivated users cannot log in and remain visible in history. Purge is a separate Admin action for test data.
12. First password: Admin sets a temporary password; the user must change it at first login. Password resets by Admin are always temporary passwords.

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
As an Empleado, I see my legajo and submit changes to my personal data (groups A to D in section 5).
- My changes to groups A to D and the documents I upload stay pending until an Admin approves them (detail in US-7).
- While a change is pending, I see the current value plus my submitted value marked as pending; if it is rejected, I see the reason.
- Work data (group E) is read-only for Empleado, enforced in RLS and in the Server Action.
- Required fields and validation rules from section 5 are enforced.
- I can view and download my own documents.

### US-4 Legajos (Admin)
As Admin, I see the list of employees and open any legajo.
- I can edit all legajo data (groups A to E); my changes apply directly, with no approval step.
- I review pending changes and document uploads from employees and approve or reject them (detail in US-7).
- I can upload, replace, delete and download documents for any employee; files go to a private bucket.
- The Legajos list shows a KPI strip with legajo-based numbers only (no licencias or recibos metrics in Fase 1).

### US-5 User management
As Admin, I create an employee account and assign a role.
- Account creation includes a temporary password that the user must change at first login (detail in US-9).
- Accounts are deactivated, not deleted (detail in US-8).
- The new user can log in and sees only their own legajo.

### US-6 Branding, theme and copy
- The TSM logo (`public/logotsm.png`) is the only element at the top of the sidebar.
- The TSM palette and typography from the prototype are applied.
- Every screen works in light and dark mode; the user switches with a manual toggle.
- All UI text comes from the es-AR copy module.

### US-7 Aprobación de cambios
- An Empleado saving a change to groups A to D, or uploading a document, creates a pending item; the current value stays in place.
- The Empleado sees their submitted value marked as pending, and the reason if it was rejected.
- An Admin sees pending items with an in-app indicator, reviews the submitted value against the current one, and approves or rejects with a reason.
- On approval the value (or document) becomes current; on rejection nothing changes.
- Every decision records who and when.

### US-8 Estado de la cuenta
- Estado de la cuenta is Activa or Inactiva. Deactivating sets it to Inactiva.
- An Admin deactivates an account with a reason; the user can no longer log in.
- Deactivated employees are hidden from the Legajos list by default, with a filter to show them.
- History keeps showing deactivated users by name.
- An Admin can purge an account, typing its email to confirm; this removes the account, legajo, documents and approval history permanently.
- No user can deactivate or purge their own account.

### US-9 Primera contraseña
- An Admin creates the account with a temporary password and passes it to the employee.
- At first login the user must set a new password before reaching any other screen.
- An Admin reset always produces a temporary password with the same behaviour.

### US-10 Production
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
- Estado laboral* — options: Activo, En prueba ("En licencia" is added with the Licencias module in Fase 3)
  Estado laboral describes the employment situation and is independent of Estado de la cuenta (US-8), which controls access to the portal.
- Sede*
- Modalidad*
- Convenio*
- Bruto mensual*

### 5.6 Edit permissions
| Group | Empleado (own legajo only) | Admin (any legajo) |
|---|---|---|
| A to D | Submits changes; they apply after Admin approval | Read and edit, applied directly |
| E (laborales, including Bruto mensual) | Read only | Read and edit |
| Documents | Uploads own; they apply after Admin approval; reads own | Uploads, replaces, deletes and reads for anyone |

Validation (required fields, DNI digits only, Partido otro, children rule) is enforced on the server, not only in the form.

### 5.7 Field validations
- CUIL: 11 digits in `XX-XXXXXXXX-X` format, prefix 20, 23, 24 or 27, with the check digit validated (modulo 11; a DNI whose check digit would be 10 takes prefix 23).
- DNI: digits only.
- Email personal: valid email format.
- Teléfonos (celular and emergency): 8 to 20 characters, digits plus optional spaces, hyphens, parentheses and a leading `+`. No country-specific format enforced.
- Grupo sanguíneo, Sede, Área, Puesto, Convenio: free text for now. They may become fixed lists later.
- Fecha de nacimiento and Fecha de ingreso: valid dates, not in the future.
- Bruto mensual: non-negative number.

## 6. Open decisions
| # | Decision | Needed before |
|---|---|---|
| 1 | Real domain and DNS | F1-12 |

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
