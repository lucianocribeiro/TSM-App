# Constitución — Portal "Mi TSM"
Version: 0.4 (draft) | Owner: Luciano Ribeiro (Agencia Kairos)

This document wins over `CLAUDE.md`, skills and prompts in any conflict. Changes require Luciano's approval and a version bump.

## 1. Product
- "Mi TSM" is the HR portal for Tecno San Martín.
- Modules: Legajo (Fase 1), Recibos de sueldo y firma electrónica (Fase 2), Licencias y ausencias (Fase 3), Comunicados internos (Fase 3).
- UI language: es-AR (voseo). All UI text lives in the copy module (`src/lib/copy/`). No hardcoded strings in components.

## 2. Stack
- Next.js App Router + TypeScript strict.
- Supabase: Postgres, Auth, Storage, RLS.
- Tailwind CSS.
- Vercel (production). No staging environment.
- Vitest (unit and integration) + Playwright (e2e).
- GitHub Actions CI: typecheck, lint, unit, build, integration (RLS), e2e. CI is the authoritative gate.
- Repo: https://github.com/lucianocribeiro/TSM-App

## 3. Roles
- **Empleado**: reads own legajo and own documents; submits changes to own personal data (groups A to D) and uploads own documents, both of which take effect only after Admin approval; reads own work data (group E, including Bruto mensual) without editing it. Never sees any other employee's data, rows or files.
- **Admin**: sees and manages all data; manages users and roles; edits all legajo data of any employee; uploads documents.
- No other roles exist. Adding one requires a Constitution change.

## 4. Auth and access
- Email + password only. No magic link, OAuth or SSO.
- Every table has RLS enabled. Default deny.
- Data isolation: an Empleado can never read or write another employee's rows or files (tables and storage).
- Feature reads and writes use the server client bound to the user session. The service-role client (`src/lib/supabase/admin.ts`) is confined to server-only modules that verify the caller is an active Admin before any privileged call (today, the account-management module `src/lib/admin/cuentas.ts`), plus system jobs and seeds. It is never reachable from a page, layout, client component or any other action. Lint enforces the restriction.
- Role checks exist both in RLS and in server-side guards (`requireRole`). App-level filters are layered on top of RLS where RLS is broader than the view's intent.
- Storage buckets are private. Access through signed URLs only.

## 5. Core patterns
- Server Actions return `{ ok: true, data? } | { ok: false, error }`. Never throw user-facing errors across a Server Action boundary.
- Sensitive state transitions go through SECURITY DEFINER RPCs with explicit role guards and a fixed `search_path`.
- Migrations: inspect the real schema first, write only the delta, sequential numbering, never edit an applied migration.
- Database types regenerated after every migration.
- No secrets in the repo. Env values contain no `#` characters.

## 6. Menu (Fase 1)
- Mi Legajo (Empleado and Admin).
- Legajos (Admin only).
- Usuarios (Admin only).
- Later phases add: Mis Recibos / Recibos, Licencias, Comunicados.

## 7. Brand and UI
- Visual style and layout follow the approved Claude Design prototype ("Gestión de Empleados"). The prototype defines style and structure only; fields and scope come from the PRD.
- Light and dark modes on every screen, switched with a manual toggle. Colors only through theme tokens.
- The sidebar shows only the TSM logo (`public/logotsm.png`) at the top. No tagline or subtitle.

## 8. Working model
- Luciano creates external accounts and projects and fills `.env.local` with credentials. He does not run commands or edit repo files.
- Claude Code builds: commits, pushes, opens PRs. It merges only through a versioned merge prompt (`TSM-Fx-MRG-NN`), merge commit only, never squash.
- Claude Code applies remote changes (migrations with `supabase db push`, remote Supabase settings) only through a versioned runbook prompt (`TSM-Fx-PUSH-NN`), after the related PR is merged, using credentials from `.env.local`. It never prints, logs or copies secret values, and never runs seeds or destructive commands against the remote project.
- Codex audits against this Constitution and the phase PRD. It writes no code.
- Every instruction to Claude Code or Codex is a versioned prompt relayed by Luciano. Prompts and audit reports are not stored in the repo.

## 9. Approval of employee changes
- Changes an Empleado makes to groups A to D, and documents an Empleado uploads, are stored as pending and do not replace the current value until an Admin approves them.
- While pending, the Empleado sees the current value plus their submitted value marked as pending.
- An Admin approves or rejects. A rejection carries a reason, which the Empleado sees.
- Admin changes apply directly, with no approval step.
- Pending items are surfaced to Admin by an in-app indicator. No email notifications in Fase 1.
- Every approval and rejection records who did it and when, and is kept as history.

## 10. Accounts: status and history
- Every account has an Estado de la cuenta: Activa or Inactiva.
- Accounts are never deleted as part of normal operation. They are deactivated, with a reason recorded (free text for now). Deactivating sets Estado de la cuenta to Inactiva.
- A user whose account is Inactiva cannot log in.
- History keeps naming who uploaded, changed, approved or rejected each item, including users whose account is Inactiva.
- Purge (permanent removal of the account, its legajo, documents and approval history) is an Admin action intended for test data. It requires typing the account's email to confirm.
- No user can deactivate or purge their own account.
