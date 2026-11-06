// FormData inputs of the Server Actions (AUD-SEC-01-01): a form posted to an
// action carries exactly its own fields. Any other key refuses the whole
// input, instead of being ignored. The one exception is the fields React and
// Next.js add to a form bound to a Server Action, all named "$ACTION_…"; they
// are never read by the actions.

const PREFIJO_FRAMEWORK = "$ACTION_";

export function soloCamposPermitidos(formData: unknown, campos: readonly string[]): formData is FormData {
  if (!(formData instanceof FormData)) return false;
  for (const clave of formData.keys()) {
    if (!campos.includes(clave) && !clave.startsWith(PREFIJO_FRAMEWORK)) return false;
  }
  return true;
}
