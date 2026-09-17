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
