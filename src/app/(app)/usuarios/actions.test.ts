import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";

// The Usuarios Server Actions: role check first, input shape, delegation to the
// Admin account module, revalidation, and no password in any result.

const mocks = vi.hoisted(() => ({
  sessionWithRole: vi.fn(),
  revalidatePath: vi.fn(),
  crearUsuario: vi.fn(),
  resetPasswordTemporal: vi.fn(),
  desactivarCuenta: vi.fn(),
  reactivarCuenta: vi.fn(),
  purgarCuenta: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ sessionWithRole: mocks.sessionWithRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin/cuentas", () => ({
  crearUsuario: mocks.crearUsuario,
  resetPasswordTemporal: mocks.resetPasswordTemporal,
  desactivarCuenta: mocks.desactivarCuenta,
  reactivarCuenta: mocks.reactivarCuenta,
  purgarCuenta: mocks.purgarCuenta,
}));

const actions = await import("./actions");
const errors = copy.cuentas.errors;
const ID = randomUUID();
const PASSWORD = "Temporal-2026";

const cases = [
  ["crearUsuarioAction", actions.crearUsuarioAction, mocks.crearUsuario, { email: "nuevo@mitsm.test", rol: "empleado", passwordTemporal: PASSWORD }],
  ["restablecerPasswordAction", actions.restablecerPasswordAction, mocks.resetPasswordTemporal, { profileId: ID, passwordTemporal: PASSWORD }],
  ["desactivarCuentaAction", actions.desactivarCuentaAction, mocks.desactivarCuenta, { profileId: ID, motivo: "Baja" }],
  ["reactivarCuentaAction", actions.reactivarCuentaAction, mocks.reactivarCuenta, { profileId: ID }],
  ["purgarCuentaAction", actions.purgarCuentaAction, mocks.purgarCuenta, { profileId: ID, emailConfirmacion: "x@mitsm.test" }],
] as const;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.sessionWithRole.mockResolvedValue({ id: "admin-1", role: "admin" });
});

describe.each(cases)("%s", (_name, action, operation, input) => {
  it("refuses a caller who is not an active Admin before anything else", async () => {
    mocks.sessionWithRole.mockResolvedValue(null);
    await expect(action(input)).resolves.toEqual({ ok: false, error: errors.noAutorizado });
    expect(mocks.sessionWithRole).toHaveBeenCalledWith("admin");
    expect(operation).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an input with the wrong shape without calling the module", async () => {
    const invalid: unknown[] = [null, "texto", {}];
    if ("profileId" in input) invalid.push({ ...input, profileId: "no-es-uuid" });
    for (const bad of invalid) {
      await expect(action(bad)).resolves.toEqual({ ok: false, error: errors.accionFallo });
    }
    expect(operation).not.toHaveBeenCalled();
  });

  it("passes the parsed input to the module and revalidates on success", async () => {
    operation.mockResolvedValue({ ok: true });
    const result = await action({ ...input, extra: "ignorado" });
    expect(result.ok).toBe(true);
    expect(operation).toHaveBeenCalledWith(input);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/usuarios", "layout");
  });

  it("returns the module's es-AR error and does not revalidate on failure", async () => {
    operation.mockResolvedValue({ ok: false, error: errors.ultimoAdmin });
    await expect(action(input)).resolves.toEqual({ ok: false, error: errors.ultimoAdmin });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("never returns the password", async () => {
    operation.mockResolvedValue({ ok: true, data: { profileId: ID } });
    expect(JSON.stringify(await action(input))).not.toContain(PASSWORD);
  });
});

describe("purgarCuentaAction", () => {
  it("keeps the removal counts on the server", async () => {
    mocks.purgarCuenta.mockResolvedValue({ ok: true, data: { objetos: 2, documentos: 1, hijos: 0, solicitudes: 0, eventos: 3 } });
    await expect(actions.purgarCuentaAction({ profileId: ID, emailConfirmacion: "x@mitsm.test" })).resolves.toEqual({ ok: true });
  });
});

describe("crearUsuarioAction", () => {
  it("rejects an unknown role", async () => {
    await expect(actions.crearUsuarioAction({ email: "a@mitsm.test", rol: "jefe", passwordTemporal: PASSWORD })).resolves.toEqual({
      ok: false,
      error: errors.accionFallo,
    });
  });
});
