// Fills {name} placeholders in a copy string. Unknown placeholders stay as
// they are, so a missing value is visible rather than silently empty.
export function formatCopy(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? values[key] : match,
  );
}
