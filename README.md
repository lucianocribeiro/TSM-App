# Mi TSM

HR portal for Tecno San Martín. Built with Next.js (App Router), TypeScript, Tailwind CSS and Supabase.

## Prerequisites

- Node.js (version in `.nvmrc`) and npm
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- Docker (required by the local Supabase stack)

## Run locally

```bash
npm ci
supabase start
cp .env.example .env.local
```

Fill `.env.local` with the values printed by `supabase status` (API URL, anon key, service role key). Then:

```bash
npm run dev
```

The app runs at http://localhost:3000.

## Local test users

`supabase start` and `supabase db reset` load `supabase/seed.sql`, which creates these users. They are **local and CI test data only**: never create them in the remote project.

| Role | Email | Password |
|---|---|---|
| Admin | `admin@mitsm.test` | `TestPass123!` |
| Empleado | `empleado.a@mitsm.test` | `TestPass123!` |
| Empleado | `empleado.b@mitsm.test` | `TestPass123!` |

Public sign-up is disabled; accounts are created by an Admin.

## Database types

After any migration, with the local stack running:

```bash
npm run db:types
```

This regenerates `src/lib/supabase/database.types.ts` from the local database. Commit the result.

## Checks and tests

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm run test:unit   # Vitest unit tests
npm run build       # Production build
```

### Integration tests

Run against the local Supabase stack only. Export the local values first:

```bash
supabase start
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase status>
export SUPABASE_SERVICE_ROLE_KEY=<service role key from supabase status>
npm run test:integration
```

### End-to-end tests

Playwright runs against a production build:

```bash
npx playwright install chromium
npm run build
npm run test:e2e
```

The Supabase public env vars must be set (for example from `.env.local`).
