// Result shape returned by every Server Action. User-facing errors are
// returned, never thrown.
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };
