---
name: es-ar-copy
description: Use whenever you add or change any user-facing text, including errors, labels, buttons, empty states and emails.
---
# es-AR copy

1. All UI text lives in `src/lib/copy/`, typed. Components import it; no literal UI strings in components.
2. Spanish from Argentina with voseo: "Ingresá", "Revisá", "Tu legajo".
3. Clear, short, professional. No jargon toward the Empleado.
4. Error messages say what happened and what to do next. Never expose technical details, stack traces or database messages.
5. Keys grouped by module (`auth`, `legajo`, `usuarios`, `common`). Reuse `common` keys instead of duplicating.
6. Dates and numbers formatted with the `es-AR` locale.
