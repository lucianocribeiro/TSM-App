---
name: rls-tests
description: Use when adding or changing any table, RLS policy, RPC or storage bucket, to prove role boundaries and data isolation.
---
# RLS tests

Integration tests run with Vitest against the local Supabase stack (`npm run test:integration`).

## The access matrix (every new table or bucket)
Every table and bucket has one entry in `TABLAS` in `tests/integration/matriz-acceso.ts`. The type requires an entry for every table in the generated types, so a new table fails the type check until it has one. Each entry defines:
- `preparar` / `limpiar`: fresh target data owned by the cell's titular (service role), removed after the cell;
- `estado`: everything the operations could touch, read with the service role;
- `ops`: SELECT, INSERT, UPDATE and DELETE as the caller;
- `esperado`: the exact outcome (`permitido`, `sin-filas`, `denegado` or `error:<code>`) for **every** actor and **every** operation, including the ones no role may do.

Actors (all mandatory):
1. `anon`.
2. `empleado-propio` and `empleado-ajeno`: an Empleado on their own and on another employee's data.
3. `admin`.
4. `desactivado-propio`, `admin-desactivado-ajeno`, `admin-desactivado-propio`: an inactive account, holding an access token captured before the deactivation (still unexpired, session closed). Only SELECT of their own `profiles` row is allowed; everything else is `sin-filas` or `denegado`.
5. `cambio-forzado-propio`: a pending forced password change. The database treats this user as an active Empleado by design (the app refuses them); expect the same cells as `empleado-propio`.

`matriz-acceso.test.ts` runs the role actors and `estado-cuenta-rls.test.ts` the account-state actors. A cell that is not `permitido` must leave the titular's data exactly as it was (the runner checks it).

## Fixtures
`tests/integration/actores.ts`:
- `crearDesactivado` / `crearCambioForzado`: the state set through the real functions by an active Admin; `porToken` is a client bound to the access token captured before, for PostgREST, RPC and Storage; `client` is the session a browser would still hold, for Server Actions.
- `sembrar`: one of each kind of own data (pending request, pending and approved documents with objects, a rowless object).
- `instantanea`: every row, object and Auth user state of a set of accounts, to prove nothing changed.

## Functions (RPC)
- Every function in the generated types has an entry in the `RPCS` table of `estado-cuenta-rls.test.ts` (the type requires it): refused (42501) for an inactive caller, or the helper's "no" (`false` / `null`), or a pure validator.
- Calling as the wrong role fails with the exact SQLSTATE and HINT.
- Triggers and internal functions are tested through their public boundary (`disparadores.test.ts`): the exact exception, unchanged rows and storage metadata, and rollback.

## Server Actions
Every action in the inventory has an entry in `CASOS` in `acciones-frontera.test.ts` (the suite fails otherwise), with each state (no session, wrong role, inactive, forced change), a foreign id and invalid input, or a written reason why a column does not apply.

Rules:
- Create test users and data with the service-role client in setup only; run assertions with clients signed in as each test user.
- Tests are independent and clean up after themselves.
- Assert on the specific failure (no rows returned or permission error, with its code), not just "no crash", and assert that nothing changed.
