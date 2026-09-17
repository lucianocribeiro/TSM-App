# Constitución — Portal "Mi TSM"
Version: 0.2 (draft) | Owner: Luciano Ribeiro (Agencia Kairos)

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
- **Empleado**: reads own legajo and own documents; edits own personal data (groups A to D); reads own work data (group E, including Bruto mensual) without editing it. Never sees any other employee's data, rows or files.
- **Admin**: sees and manages all data; manages users and roles; edits all legajo data of any employee; uploads documents.
- No other roles exist. Adding one requires a Constitution change.

## 4. Auth and access
- Email + password only. No magic link, OAuth or SSO.
- Every table has RLS enabled. Default deny.
- Data isolation: an Empleado can never read or write another employee's rows or files (tables and storage).
- Feature reads and writes use the server client bound to the user session. The service-role client (`src/lib/supabase/admin.ts`) is only for system jobs and seeds.
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
- Claude Code builds: commits, pushes, opens PRs. Claude Code merges only when a versioned merge prompt (`TSM-Fx-MRG-NN`) instructs it, always with a merge commit, never squash.
- Codex audits against this Constitution and the phase PRD. Writes no feature code.
- Luciano approves every merge by relaying the merge prompt, and is the only one who runs `supabase db push`.
- Every instruction to Claude Code or Codex is a versioned prompt pasted by Luciano. Prompts and audit reports are not stored in the repo.
