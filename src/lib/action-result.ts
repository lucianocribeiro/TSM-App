// Result shape returned by every Server Action. User-facing errors are
// returned, never thrown. Form actions may add field errors, keyed by field
// ("cuil", or "hijos.0.nombre_completo" inside a list), in es-AR.
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
