import { describe, expect, it } from "vitest";
import { copy } from "./es-AR";

function collectStrings(value: unknown, path = "copy"): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      collectStrings(child, `${path}.${key}`),
    );
  }
  return [];
}

describe("es-AR copy", () => {
  it("has no empty strings", () => {
    for (const [path, text] of collectStrings(copy)) {
      expect(text.trim(), path).not.toBe("");
    }
  });

  it("defines the keys used by the app shell and login", () => {
    const shellKeys = [
      copy.app.name,
      copy.app.logoAlt,
      copy.common.comingSoon,
      copy.common.openMenu,
      copy.common.closeMenu,
      copy.auth.login.title,
      copy.auth.login.emailLabel,
      copy.auth.login.passwordLabel,
      copy.auth.login.submit,
      copy.auth.login.submitting,
      copy.auth.errors.invalidCredentials,
      copy.auth.errors.logoutFailed,
      copy.auth.logout,
      copy.auth.roles.empleado,
      copy.auth.roles.admin,
      copy.nav.label,
      copy.nav.miLegajo,
      copy.nav.legajos,
      copy.nav.usuarios,
      copy.theme.toDark,
      copy.theme.toLight,
      copy.miLegajo.kicker,
      copy.miLegajo.title,
      copy.legajos.kicker,
      copy.legajos.title,
      copy.usuarios.kicker,
      copy.usuarios.title,
    ];
    for (const text of shellKeys) {
      expect(typeof text).toBe("string");
      expect(text.trim()).not.toBe("");
    }
  });

  it("uses the generic login error from the PRD", () => {
    expect(copy.auth.errors.invalidCredentials).toBe(
      "Email o contraseña incorrectos.",
    );
  });
});
