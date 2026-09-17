---
name: new-module
description: Use when creating a new route, page or feature module in Mi TSM.
---
# New module

1. Place routes under `src/app/` following the existing route groups.
2. Protect the route: authenticated session required; call `requireRole` in the server layer for role-restricted pages. Never rely only on hiding menu items.
3. Data access: server client bound to the session. Never use `admin.ts` for feature reads or writes.
4. Mutations: Server Actions returning `{ ok, error }`. Validate input on the server. Re-check role on the server.
5. Add the menu entry only for the roles defined in the Constitution.
6. All text through `src/lib/copy/` (`es-ar-copy` skill).
7. Styling through the design system and theme tokens; verify light and dark modes.
8. Tests: unit tests for logic, RLS tests for data (`rls-tests`), e2e for the main flow and the role boundary (Empleado blocked from Admin routes).
