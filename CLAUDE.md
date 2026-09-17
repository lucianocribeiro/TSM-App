# CLAUDE.md — Portal "Mi TSM"

Read `docs/constitucion.md` and the current phase PRD (`docs/prd-fase-1.md`) before any task. The Constitution wins over this file.

## Role
You build. You commit, push and open PRs. You merge only when a versioned merge prompt (`TSM-Fx-MRG-NN`) tells you to, with a merge commit, never squash. You never run `supabase db push` and never link to or write to the remote Supabase project.

## Every task
1. Work only from a versioned prompt. If the request is not in a prompt, stop and ask.
2. Branch from up-to-date `main`. One piece per branch and PR.
3. Stay inside the prompt's scope. Report ambiguities and conflicts instead of guessing.
4. Before finishing, run the `dod-checklist` skill.
5. Finish with the report format the prompt requests, inside a code fence.

## Commands
- `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build`
- `npm run test:integration` (needs local Supabase running; use the Supabase CLI version pinned in CI)
- `npm run test:e2e`
- `next dev` must not write agent rules; `agentRules: false` is set in `next.config.ts`.

## Structure
- `src/app/` routes (App Router).
- `src/proxy.ts` Next.js 16 proxy (formerly middleware): session refresh and, from F1-10, route guards.
- `src/lib/supabase/` clients: `client.ts` (browser), `server.ts` (session-bound), `admin.ts` (service role, system jobs and seeds only).
- `src/lib/copy/` all es-AR UI text.
- `supabase/migrations/` sequential migrations.
- `docs/` Constitution and phase PRDs.
- `.claude/skills/` repo skills.

## Non-negotiables
- TypeScript strict. No `any` without a written justification in the code.
- RLS on every table, default deny. Empleado never reaches another employee's data.
- Role checks in RLS and in server guards.
- Server Actions return `{ ok, error }`; never throw user-facing errors.
- No hardcoded UI strings; use `src/lib/copy/`. UI text in es-AR (voseo).
- Colors only through theme tokens; every screen works in light and dark mode.
- Private storage, signed URLs only.
- No secrets in the repo.
- Code, comments and commits in English.

## Skills
- `supabase-migration`: any schema, RLS, RPC or storage policy change.
- `rls-tests`: any new table, policy or bucket.
- `new-module`: any new route or feature module.
- `es-ar-copy`: any user-facing text.
- `dod-checklist`: before reporting any piece as done.
- `design-system`: added in F1-04. Until then, do not build styled UI.

## Design
Added in F1-04 from the approved prototype.
