import { describe, expect, it } from "vitest";
import { copy } from "./es-AR";
import { copyLaborales } from "./laborales";

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
      copy.common.ocultarMenu,
      copy.common.mostrarMenu,
      copy.auth.login.title,
      copy.auth.login.emailLabel,
      copy.auth.login.passwordLabel,
      copy.auth.login.submit,
      copy.auth.login.submitting,
      copy.auth.errors.invalidCredentials,
      copy.auth.errors.logoutFailed,
      copy.auth.logout,
      copy.auth.cuenta,
      copy.auth.roles.empleado,
      copy.auth.roles.admin,
      copy.nav.label,
      copy.nav.miLegajo,
      copy.nav.legajos,
      copy.nav.usuarios,
      copy.nav.configuracion,
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

  it("defines the approval states, reason label and errors", () => {
    const aprobacionKeys = [
      ...Object.values(copy.aprobaciones.solicitudEstados),
      ...Object.values(copy.aprobaciones.documentoEstados),
      copy.aprobaciones.pendienteHint,
      copy.aprobaciones.motivoRechazoLabel,
      ...Object.values(copy.aprobaciones.errors),
    ];
    for (const text of aprobacionKeys) {
      expect(typeof text).toBe("string");
      expect(text.trim()).not.toBe("");
    }
    expect(Object.keys(copy.aprobaciones.solicitudEstados).sort()).toEqual(
      ["aprobada", "cancelada", "pendiente", "rechazada"],
    );
    expect(Object.keys(copy.aprobaciones.documentoEstados).sort()).toEqual(
      ["aprobado", "pendiente", "rechazado", "reemplazado"],
    );
    expect(copy.aprobaciones.errors.solicitudPendiente).toMatch(/^Ya tenés una solicitud pendiente/);
  });

  it("defines the password, account and inactive-account texts", () => {
    const keys = [
      copy.auth.errors.cuentaInactiva,
      copy.auth.errors.cuentaNoVerificada,
      copy.password.kicker,
      copy.password.title,
      copy.password.intro,
      copy.password.introVoluntaria,
      copy.password.actualLabel,
      copy.password.nuevaLabel,
      copy.password.confirmacionLabel,
      copy.password.hint,
      copy.password.submit,
      copy.password.submitting,
      ...Object.values(copy.password.errors),
      ...Object.values(copy.cuentas.estados),
      ...Object.values(copy.cuentas.eventos),
      ...Object.values(copy.cuentas.errors),
    ];
    for (const text of keys) {
      expect(typeof text).toBe("string");
      expect(text.trim()).not.toBe("");
    }
    expect(Object.keys(copy.cuentas.eventos).sort()).toEqual(
      ["creacion", "desactivacion", "password_cambiada", "password_temporal", "reactivacion"],
    );
    expect(copy.auth.errors.cuentaInactiva).toBe("Tu cuenta está inactiva. Contactá a Recursos Humanos.");
    expect(copy.auth.errors.cuentaInactiva).not.toBe(copy.auth.errors.invalidCredentials);
  });

  it("defines the Usuarios screen texts, with the {email} placeholder where the dialogs need it", () => {
    function strings(value: unknown): string[] {
      if (typeof value === "string") return [value];
      return value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
    }
    for (const text of [...strings(copy.usuarios), copy.nav.cambiarPassword]) {
      expect(text.trim()).not.toBe("");
    }
    for (const text of [
      copy.usuarios.restablecer.body,
      copy.usuarios.desactivar.body,
      copy.usuarios.reactivar.body,
      copy.usuarios.purgar.body,
      copy.usuarios.passwordUnaVez.creada,
      copy.usuarios.passwordUnaVez.restablecida,
    ]) {
      expect(text).toContain("{email}");
    }
    expect(copy.usuarios.purgar.body).toMatch(/para siempre/);
    expect(copy.usuarios.purgar.body).toMatch(/prueba/);
    expect(copy.usuarios.passwordUnaVez.note).toMatch(/No la vamos a volver a mostrar/);
  });

  it("defines the Mi Legajo texts, with the placeholders the page fills", () => {
    function strings(value: unknown): string[] {
      if (typeof value === "string") return [value];
      return value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
    }
    for (const text of [
      ...strings(copy.miLegajo),
      copy.legajo.validation.cuilInvalid,
      copy.legajo.validation.cuilPrefijo,
      copy.legajo.validation.cuilDigito,
      copy.legajo.validation.telefonoInvalid,
      copy.legajo.validation.fechaFutura,
      copy.aprobaciones.errors.valorInvalido,
    ]) {
      expect(text.trim()).not.toBe("");
    }
    expect(copy.miLegajo.pendiente.valor).toContain("{valor}");
    expect(copy.miLegajo.rechazada.banner).toContain("{motivo}");
    expect(copy.miLegajo.documentos.motivoRechazo).toContain("{motivo}");
    expect(copy.miLegajo.documentos.archivoLabel).toContain("{documento}");
    expect(copy.miLegajo.hijos.hijoN).toContain("{n}");
    // Group E is Admin only: its title lives in ./laborales.ts (AUDCR2-01).
    expect(Object.keys(copy.miLegajo.grupos)).toEqual(["A", "B", "C", "D"]);
  });

  it("keeps group E labels out of the shared copy, in the Admin-only module", () => {
    const compartido = collectStrings(copy).map(([, text]) => text);
    for (const etiqueta of [copyLaborales.grupo, copyLaborales.campos.numero_legajo, copyLaborales.campos.fecha_ingreso]) {
      expect(compartido, etiqueta).not.toContain(etiqueta);
    }
    for (const [path, text] of collectStrings(copyLaborales, "copyLaborales")) {
      expect(text.trim(), path).not.toBe("");
    }
    expect(copyLaborales.grupo).toBe("Datos laborales");
    expect(copyLaborales.form.obligatorio).toContain("{campo}");
    expect(copyLaborales.form.inactivo).toContain("{nombre}");
    expect(copyLaborales.listado.numeroLegajo).toContain("{numero}");
  });

  it("defines the Alta de AFIP texts: its type label and the owner's download-only states", () => {
    expect(copy.documentos.tipos.alta_afip).toBe("Alta de AFIP");
    expect(copy.miLegajo.documentos.soloAdmin.faltante).toBe("Lo carga Recursos Humanos");
    expect(copy.miLegajo.documentos.soloAdmin.aprobado.trim()).not.toBe("");
    expect(copy.miLegajo.documentos.errors.soloAdmin.trim()).not.toBe("");
  });

  it("uses the generic login error from the PRD", () => {
    expect(copy.auth.errors.invalidCredentials).toBe(
      "Email o contraseña incorrectos.",
    );
  });

  // Post-deploy adjustment ADJ-01.3: the section title already says it.
  it("group D field labels do not repeat that they are about the emergency contact", () => {
    const campos = copy.aprobaciones.campos;
    for (const campo of ["emergencia_nombre", "emergencia_parentesco", "emergencia_domicilio", "emergencia_telefono"] as const) {
      expect(campos[campo].toLowerCase(), campo).not.toContain("emergencia");
    }
    expect(copy.miLegajo.grupos.D).toBe("Datos de emergencia");
  });
});
