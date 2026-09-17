---
name: dod-checklist
description: Run before reporting any piece as done.
---
# Definition of Done checklist

Report each item as pass, fail or not applicable:
1. `typecheck`, `lint`, `test:unit`, `build` pass locally.
2. `test:integration` and `test:e2e` pass locally when the piece touches data or UI.
3. CI is green on the PR (all jobs).
4. Scope matches the prompt; nothing extra.
5. RLS enabled and tested for every new table and bucket.
6. Role checks present in RLS and server guards.
7. No hardcoded UI strings; es-AR voseo.
8. Light and dark modes verified on changed screens.
9. No secrets or real keys committed.
10. Types regenerated if a migration was added.
11. Migrations listed in the PR with a `db push` runbook note.
12. PR open, not merged. Branch pushed.
