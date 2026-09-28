import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { legajoActual } from "@/lib/aprobaciones/fixtures.test-helpers";

// The /aprobaciones actions with the loaders and the session client replaced:
// the role boundary, items decided elsewhere, the own-account rule, the
// re-validation before approving and the reason rules. Nothing reaches the
// decision functions when a check fails first.

const ADMIN = "11111111-1111-4111-8111-111111111111";
const EMPLEADO = "22222222-2222-4222-8222-222222222222";
const SOLICITUD = "33333333-3333-4333-8333-333333333333";
const DOCUMENTO = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({
  role: "admin" as "admin" | "empleado",
  rpc: null as unknown as Mock<(...args: unknown[]) => Promise<unknown>>,
  cargarSolicitud: null as unknown as Mock<(id: string) => Promise<unknown>>,
  cargarDocumento: null as unknown as Mock<(id: string) => Promise<unknown>>,
  contarPendientes: null as unknown as Mock<() => Promise<number | null>>,
  revalidated: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => state.revalidated.push(path) }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => ({
    id: state.role === "admin" ? ADMIN : EMPLEADO,
    email: "a@mitsm.test",
    role: state.role,
    cuenta: { estadoCuenta: "activa", debeCambiarPassword: false },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/aprobaciones/bandeja-datos", () => ({
  cargarSolicitud: (id: string) => state.cargarSolicitud(id),
  cargarDocumento: (id: string) => state.cargarDocumento(id),
  contarPendientes: () => state.contarPendientes(),
}));

const actions = await import("./actions");
const errors = copy.aprobaciones.errors;
const noAutorizado = { ok: false, error: copy.cuentas.errors.noAutorizado };
const empleado = (profileId = EMPLEADO) => ({ profileId, nombres: "Prueba", apellido: "Ficticio", numeroLegajo: "L-1", estadoCuenta: "activa" });

function solicitud(over: Record<string, unknown> = {}) {
  return {
    id: SOLICITUD,
    estado: "pendiente",
    enviadoEn: "2026-09-20T10:00:00Z",
    items: [{ campo: "telefono_celular", valorPropuesto: "1122223333" }],
    empleado: empleado(),
    actual: legajoActual(),
    ...over,
  };
}

function documento(over: Record<string, unknown> = {}) {
  return { id: DOCUMENTO, estado: "pendiente", tipo: "dni_frente", empleado: empleado(), vigente: null, ...over };
}

beforeEach(() => {
  state.role = "admin";
  state.revalidated = [];
  state.rpc = vi.fn(async () => ({ data: null, error: null }));
  state.cargarSolicitud = vi.fn(async () => solicitud());
  state.cargarDocumento = vi.fn(async () => documento());
  state.contarPendientes = vi.fn(async () => 4);
});

describe("role boundary", () => {
  it("refuses an Empleado on every action before reading or deciding anything", async () => {
    state.role = "empleado";
    const results = await Promise.all([
      actions.aprobarSolicitud({ solicitudId: SOLICITUD }),
      actions.rechazarSolicitud({ solicitudId: SOLICITUD, motivo: "x" }),
      actions.aprobarDocumento({ documentoId: DOCUMENTO }),
      actions.rechazarDocumento({ documentoId: DOCUMENTO, motivo: "x" }),
      actions.descargarDocumentoBandeja({ documentoId: DOCUMENTO }),
      actions.contarPendientesCampana(),
    ]);
    for (const result of results) expect(result).toEqual(noAutorizado);
    expect(state.cargarSolicitud).not.toHaveBeenCalled();
    expect(state.cargarDocumento).not.toHaveBeenCalled();
    expect(state.contarPendientes).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("gives the Admin the bell count", async () => {
    expect(await actions.contarPendientesCampana()).toEqual({ ok: true, data: { total: 4 } });
    state.contarPendientes = vi.fn(async () => null);
    expect((await actions.contarPendientesCampana()).ok).toBe(false);
  });
});

describe("change requests", () => {
  it("approves through aprobar_solicitud and revalidates the app layout", async () => {
    expect(await actions.aprobarSolicitud({ solicitudId: SOLICITUD })).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("aprobar_solicitud", { p_solicitud_id: SOLICITUD });
    expect(state.revalidated).toContain("/");
  });

  it("refuses to approve values that no longer validate, without calling the database", async () => {
    state.cargarSolicitud = vi.fn(async () => solicitud({ items: [{ campo: "cuil", valorPropuesto: "30-12345678-1" }] }));
    const result = await actions.aprobarSolicitud({ solicitudId: SOLICITUD });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain(copy.aprobaciones.campos.cuil);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("reports an item already decided, found before or by the database", async () => {
    const yaDecidido = { ok: false, error: errors.yaDecidido, yaDecidido: true };
    state.cargarSolicitud = vi.fn(async () => solicitud({ estado: "aprobada" }));
    expect(await actions.aprobarSolicitud({ solicitudId: SOLICITUD })).toEqual(yaDecidido);
    state.cargarSolicitud = vi.fn(async () => "no-encontrado");
    expect(await actions.rechazarSolicitud({ solicitudId: SOLICITUD, motivo: "x" })).toEqual(yaDecidido);
    expect(state.rpc).not.toHaveBeenCalled();

    // Decided in another tab between the read and the call.
    state.cargarSolicitud = vi.fn(async () => solicitud());
    state.rpc = vi.fn(async () => ({ data: null, error: { code: "55000", message: "Change request is not pending" } }));
    expect(await actions.aprobarSolicitud({ solicitudId: SOLICITUD })).toEqual(yaDecidido);
    expect(state.revalidated).toEqual([]);
  });

  it("never lets the Admin decide on their own legajo", async () => {
    state.cargarSolicitud = vi.fn(async () => solicitud({ empleado: empleado(ADMIN) }));
    expect(await actions.aprobarSolicitud({ solicitudId: SOLICITUD })).toEqual({ ok: false, error: errors.cuentaPropia });
    expect(await actions.rechazarSolicitud({ solicitudId: SOLICITUD, motivo: "x" })).toEqual({ ok: false, error: errors.cuentaPropia });
    expect(state.rpc).not.toHaveBeenCalled();
    // And if the database says so.
    state.cargarSolicitud = vi.fn(async () => solicitud());
    state.rpc = vi.fn(async () => ({ data: null, error: { code: "55000", hint: "cuenta_propia" } }));
    expect(await actions.aprobarSolicitud({ solicitudId: SOLICITUD })).toEqual({ ok: false, error: errors.cuentaPropia, yaDecidido: false });
  });

  it("rejects with a trimmed reason and refuses a blank or too long one", async () => {
    expect(await actions.rechazarSolicitud({ solicitudId: SOLICITUD, motivo: "  Falta el DNI.  " })).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("rechazar_solicitud", { p_solicitud_id: SOLICITUD, p_motivo: "Falta el DNI." });
    state.rpc.mockClear();
    expect(await actions.rechazarSolicitud({ solicitudId: SOLICITUD, motivo: "   " })).toEqual({ ok: false, error: errors.motivoRequerido });
    expect((await actions.rechazarSolicitud({ solicitudId: SOLICITUD, motivo: "a".repeat(501) })).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses a malformed id and hides database messages", async () => {
    expect(await actions.aprobarSolicitud({ solicitudId: "nope" })).toEqual({ ok: false, error: errors.guardarFallo });
    state.rpc = vi.fn(async () => ({ data: null, error: { code: "XX000", message: "internal detail" } }));
    const result = await actions.aprobarSolicitud({ solicitudId: SOLICITUD });
    expect(result).toEqual({ ok: false, error: errors.guardarFallo, yaDecidido: false });
  });
});

describe("documents", () => {
  it("approves and rejects through the decision functions", async () => {
    expect(await actions.aprobarDocumento({ documentoId: DOCUMENTO })).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("aprobar_documento", { p_documento_id: DOCUMENTO });
    expect(await actions.rechazarDocumento({ documentoId: DOCUMENTO, motivo: "Ilegible" })).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("rechazar_documento", { p_documento_id: DOCUMENTO, p_motivo: "Ilegible" });
  });

  it("handles an already decided document, the own account and a missing reason", async () => {
    state.cargarDocumento = vi.fn(async () => documento({ estado: "aprobado" }));
    expect(await actions.aprobarDocumento({ documentoId: DOCUMENTO })).toEqual({ ok: false, error: errors.yaDecidido, yaDecidido: true });
    state.cargarDocumento = vi.fn(async () => documento({ empleado: empleado(ADMIN) }));
    expect(await actions.aprobarDocumento({ documentoId: DOCUMENTO })).toEqual({ ok: false, error: errors.cuentaPropia });
    state.cargarDocumento = vi.fn(async () => documento());
    expect(await actions.rechazarDocumento({ documentoId: DOCUMENTO, motivo: "" })).toEqual({ ok: false, error: errors.motivoRequerido });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
