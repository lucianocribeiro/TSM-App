---
name: supabase-migration
description: Use for any database schema, RLS policy, RPC, trigger or storage policy change in Mi TSM.
---
# Supabase migration

1. Inspect the real current schema first (existing migrations and local database). Never assume a table or column exists.
2. Create a new sequential migration with `supabase migration new <snake_case_name>`. Never edit a migration that may already be applied.
3. Write only the delta.
4. Every new table: `enable row level security` in the same migration, plus explicit policies. No policy means no access (default deny).
5. Policies reference roles through the shared role helper functions, not duplicated logic.
6. SECURITY DEFINER functions: explicit role guard at the top, `set search_path = ''` (fully qualified names), minimal grants, `revoke` from `public` where applicable.
7. Storage: buckets private; policies on `storage.objects` scoped by bucket and owner path.
8. Apply locally with `supabase db reset` and confirm it runs clean from zero.
9. Regenerate types locally into the project's types file and commit them.
10. Add or update RLS tests (`rls-tests` skill).
11. Never run `supabase db push` or `supabase link`. In the PR description, list: migration file names, objects created or changed, and a note that Luciano must run the `db push` runbook.
