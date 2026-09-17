---
name: rls-tests
description: Use when adding or changing any table, RLS policy, RPC or storage bucket, to prove role boundaries and data isolation.
---
# RLS tests

Integration tests run with Vitest against the local Supabase stack (`npm run test:integration`).

For each table or bucket, cover at least:
1. Anonymous: no read, no write.
2. Empleado A: can read own rows; cannot read Empleado B's rows.
3. Empleado A: can write only the columns the PRD allows; writes to restricted columns fail.
4. Empleado A: cannot write Empleado B's rows.
5. Admin: can read all rows and perform the writes the PRD allows.
6. Storage: Empleado A cannot list, download or upload in Empleado B's path; Admin can per PRD.
7. RPCs: calling as the wrong role fails.

Rules:
- Create test users and data with the service-role client in setup only; run assertions with clients signed in as each test user.
- Tests are independent and clean up after themselves.
- Assert on the specific failure (no rows returned or permission error), not just "no crash".
