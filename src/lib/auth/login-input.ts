export type LoginInput = {
  email: string;
  password: string;
};

// Deliberately loose: only rejects values that can never be a valid email.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns the trimmed credentials, or null when the form data is missing,
// empty or malformed. Callers answer null with the generic login error.
export function parseLoginInput(formData: FormData): LoginInput | null {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string") return null;

  const trimmedEmail = email.trim();
  if (trimmedEmail === "" || password === "") return null;
  if (!EMAIL_PATTERN.test(trimmedEmail)) return null;

  return { email: trimmedEmail, password };
}
