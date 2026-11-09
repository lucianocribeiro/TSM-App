import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyRecibos } from "@/lib/copy/recibos";

// The Carga de recibos server logic with storage, the DNI check and the
// database replaced: error mapping, the non-bypassable DNI confirmation
// (decision 7) and the cleanup of every failure path. The end-to-end
// behaviour against the local stack is in
// tests/integration/recibos-carga-acciones.test.ts.

const mocks = vi.hoisted(() => ({
  descargar: vi.fn(),
  eliminar: vi.fn(),
  barrer: vi.fn(),
  urlSubida: vi.fn(),
  dni: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./cliente-privilegiado", () => ({
  descargarRecibo: (...a: unknown[]) => mocks.descargar(...a),
  eliminarRecibo: (...a: unknown[]) => mocks.eliminar(...a),
  barrerHuerfanos: (...a: unknown[]) => mocks.barrer(...a),
  crearUrlSubidaReciboPrivilegiada: (...a: unknown[]) => mocks.urlSubida(...a),
}));
vi.mock("./pdf-texto", () => ({ verificarDniEnPdf: (...a: unknown[]) => mocks.dni(...a) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const { descartar, mensajeDeFuncion, motivoDeDni, prepararSubida, registrar } = await import("./carga");

const e = copyRecibos.errors;
const EMPLEADO = "22222222-2222-4222-8222-222222222222";
const PERIODO = "33333333-3333-4333-8333-333333333333";
const PATH = `${EMPLEADO}/${PERIODO}/44444444-4444-4444-8444-444444444444.pdf`;
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

type Respuesta = { data: unknown; error: unknown };
// A session client double: each table answers from `tablas` ("tabla:una"
// for a one-row read, "tabla:lista" for a list, else "tabla"), rpc from `rpc`.
function cliente(tablas: Record<string, Respuesta>, rpc: Respuesta = { data: "recibo-id", error: null }) {
  const llamadas: { rpc: unknown[] } = { rpc: [] };
  const vacia = { data: null, error: null };
  const consulta = (tabla: string) => {
    const cadena: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "limit", "in", "order"]) cadena[metodo] = () => cadena;
    cadena.maybeSingle = async () => tablas[`${tabla}:una`] ?? tablas[tabla] ?? vacia;
    cadena.then = (ok: (r: Respuesta) => unknown) => Promise.resolve(tablas[`${tabla}:lista`] ?? tablas[tabla] ?? vacia).then(ok);
    return cadena;
  };
  const client = {
    from: consulta,
    rpc: async (...args: unknown[]) => {
      llamadas.rpc.push(args);
      return rpc;
    },
  };
  return { client: client as never, llamadas };
}

const sinReferencias = { recibos: { data: [], error: null }, recibo_historial: { data: [], error: null }, recibo_overrides: { data: [], error: null } };
const base = (extra: Record<string, Respuesta> = {}) => ({
  ...sinReferencias,
  // No current receipt in the period.
  "recibos:una": { data: null, error: null },
  legajos: { data: { dni: "12345678" }, error: null },
  ...extra,
});
const input = { periodoId: PERIODO, empleadoId: EMPLEADO, path: PATH };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.descargar.mockResolvedValue({ ok: true, bytes: PDF, mimeType: "application/pdf" });
  mocks.eliminar.mockResolvedValue(true);
  mocks.barrer.mockResolvedValue({ ok: true, eliminados: 0 });
  mocks.dni.mockResolvedValue({ estado: "encontrado" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("error mapping", () => {
  it("maps every function hint to its copy, anything else to the action's generic error", () => {
    const casos: [string, string][] = [
      ["periodo_invalido", e.periodoInvalido],
      ["periodo_existente", e.periodoExistente],
      ["periodo_inexistente", e.periodoInexistente],
      ["transicion_invalida", e.transicionInvalida],
      ["periodo_cerrado", e.periodoCerrado],
      ["empleado_no_elegible", e.empleadoNoElegible],
      ["conflicto_concurrente", e.conflicto],
      ["archivo_repetido", "generico"],
      ["ruta_recibo_ajena", "generico"],
    ];
    for (const [hint, mensaje] of casos) expect(mensajeDeFuncion({ code: "55000", hint }, "generico"), hint).toBe(mensaje);
    expect(mensajeDeFuncion({ code: "42501" }, "generico")).toBe("generico");
    expect(mensajeDeFuncion(null, "generico")).toBe("generico");
  });

  it("maps the DNI check to the override motivo", () => {
    expect(motivoDeDni({ estado: "encontrado" })).toBeNull();
    expect(motivoDeDni({ estado: "no_encontrado" })).toEqual({ motivo: "dni_no_encontrado" });
    expect(motivoDeDni({ estado: "sin_dni" })).toEqual({ motivo: "sin_dni" });
    expect(motivoDeDni({ estado: "no_verificable", motivo: "tiempo_agotado" })).toEqual({ motivo: "no_verificable", detalle: "tiempo_agotado" });
  });
});

describe("prepararSubida", () => {
  const destino = { recibo_periodos: { data: { estado: "publicado" }, error: null }, profiles: { data: { role: "empleado", estado_cuenta: "activa" }, error: null } };

  it("refuses a declared type or size before any read", async () => {
    const { client } = cliente(destino);
    expect(await prepararSubida(client, { ...input, tamano: 10, tipo: "image/png" })).toEqual({ ok: false, error: e.tipo });
    expect(await prepararSubida(client, { ...input, tamano: 10 * 1024 * 1024 + 1, tipo: "application/pdf" })).toEqual({ ok: false, error: e.muyGrande });
    expect(mocks.urlSubida).not.toHaveBeenCalled();
    expect(mocks.barrer).not.toHaveBeenCalled();
  });

  it("refuses a closed period and a non-eligible account", async () => {
    const cerrado = cliente({ ...destino, recibo_periodos: { data: { estado: "cerrado" }, error: null } });
    expect(await prepararSubida(cerrado.client, { ...input, tamano: 10, tipo: "application/pdf" })).toEqual({ ok: false, error: e.periodoCerrado });
    const admin = cliente({ ...destino, profiles: { data: { role: "admin", estado_cuenta: "activa" }, error: null } });
    expect(await prepararSubida(admin.client, { ...input, tamano: 10, tipo: "application/pdf" })).toEqual({ ok: false, error: e.empleadoNoElegible });
    const inactivo = cliente({ ...destino, profiles: { data: { role: "empleado", estado_cuenta: "inactiva" }, error: null } });
    expect(await prepararSubida(inactivo.client, { ...input, tamano: 10, tipo: "application/pdf" })).toEqual({ ok: false, error: e.empleadoNoElegible });
  });

  it("sweeps, logs an incomplete sweep without paths, and returns a fresh owner-first path", async () => {
    mocks.barrer.mockResolvedValue({ ok: false, eliminados: 1, fallidos: [PATH] });
    mocks.urlSubida.mockResolvedValue({ ok: true, token: "tok", path: "x", url: "u" });
    const { client } = cliente(destino);
    const result = await prepararSubida(client, { ...input, tamano: 10, tipo: "application/pdf" });
    expect(result.ok && result.data?.path).toMatch(new RegExp(`^${EMPLEADO}/${PERIODO}/[0-9a-f-]{36}\\.pdf$`));
    expect(result.ok && result.data?.token).toBe("tok");
    expect(String(vi.mocked(console.error).mock.calls[0])).not.toContain(EMPLEADO);
  });
});

describe("registrar", () => {
  it("refuses a path of another employee or period, or one a row already holds, touching nothing", async () => {
    const { client } = cliente(base());
    expect(await registrar(client, { ...input, empleadoId: PERIODO })).toEqual({ ok: false, error: e.registroFallo });
    const enUso = cliente(base({ recibos: { data: [{ id: "r" }], error: null } }));
    expect(await registrar(enUso.client, input)).toEqual({ ok: false, error: e.registroFallo });
    expect(mocks.descargar).not.toHaveBeenCalled();
    expect(mocks.eliminar).not.toHaveBeenCalled();
  });

  it("registers with no override when the DNI is found", async () => {
    const { client, llamadas } = cliente(base());
    expect(await registrar(client, input)).toEqual({ ok: true, data: { estado: "registrado", reciboId: "recibo-id" } });
    expect(llamadas.rpc[0]).toEqual([
      "recibo_registrar",
      { p_periodo_id: PERIODO, p_empleado_id: EMPLEADO, p_archivo_path: PATH, p_archivo_bytes: PDF.byteLength, p_reemplazar: false },
    ]);
  });

  it("asks for the DNI confirmation and keeps the file; the confirmed call records the override", async () => {
    mocks.dni.mockResolvedValue({ estado: "no_verificable", motivo: "sin_texto" });
    const { client, llamadas } = cliente(base());
    expect(await registrar(client, input)).toEqual({ ok: true, data: { estado: "confirmar_dni", motivo: "no_verificable", detalle: "sin_texto" } });
    expect(mocks.eliminar).not.toHaveBeenCalled();
    expect(llamadas.rpc).toEqual([]);

    expect(await registrar(client, { ...input, confirmarDni: "no_verificable" })).toEqual({ ok: true, data: { estado: "registrado", reciboId: "recibo-id" } });
    expect(llamadas.rpc[0]).toEqual(["recibo_registrar", expect.objectContaining({ p_override_motivo: "no_verificable" })]);
  });

  it("refuses a confirmation that does not match the motivo computed now, and removes the file (decision 7)", async () => {
    mocks.dni.mockResolvedValue({ estado: "no_encontrado" });
    const { client, llamadas } = cliente(base());
    expect(await registrar(client, { ...input, confirmarDni: "sin_dni" })).toEqual({ ok: false, error: e.dniCambio });
    // A confirmation when the DNI is found is a mismatch too.
    mocks.dni.mockResolvedValue({ estado: "encontrado" });
    expect(await registrar(client, { ...input, confirmarDni: "dni_no_encontrado" })).toEqual({ ok: false, error: e.dniCambio });
    expect(llamadas.rpc).toEqual([]);
    expect(mocks.eliminar).toHaveBeenCalledTimes(2);
  });

  it("asks before a replacement, with whether the current receipt is signed, and keeps the file", async () => {
    const actual = (estado: string) => base({ "recibos:lista": { data: [], error: null }, "recibos:una": { data: { estado }, error: null } });
    const firmado = cliente(actual("firmado"));
    expect(await registrar(firmado.client, input)).toEqual({ ok: true, data: { estado: "confirmar_reemplazo", firmado: true } });
    const pendiente = cliente(actual("pendiente"));
    expect(await registrar(pendiente.client, input)).toEqual({ ok: true, data: { estado: "confirmar_reemplazo", firmado: false } });
    expect(firmado.llamadas.rpc).toEqual([]);
    expect(mocks.eliminar).not.toHaveBeenCalled();

    // Confirmed: the function replaces.
    expect(await registrar(firmado.client, { ...input, confirmarReemplazo: true })).toEqual({
      ok: true,
      data: { estado: "registrado", reciboId: "recibo-id" },
    });
    expect(firmado.llamadas.rpc[0]).toEqual(["recibo_registrar", expect.objectContaining({ p_reemplazar: true })]);
  });

  it("asks about the DNI before the replacement", async () => {
    mocks.dni.mockResolvedValue({ estado: "sin_dni" });
    const ambos = cliente(base({ "recibos:lista": { data: [], error: null }, "recibos:una": { data: { estado: "pendiente" }, error: null } }));
    expect(await registrar(ambos.client, input)).toEqual({ ok: true, data: { estado: "confirmar_dni", motivo: "sin_dni" } });
    expect(await registrar(ambos.client, { ...input, confirmarDni: "sin_dni" })).toEqual({
      ok: true,
      data: { estado: "confirmar_reemplazo", firmado: false },
    });
  });

  it("removes the file and returns the file error when the stored bytes are not a PDF", async () => {
    mocks.descargar.mockResolvedValue({ ok: true, bytes: new TextEncoder().encode("hola"), mimeType: "application/pdf" });
    const { client } = cliente(base());
    expect(await registrar(client, input)).toEqual({ ok: false, error: e.contenido });
    expect(mocks.eliminar).toHaveBeenCalledWith(PATH);
  });

  it("removes the file when the function fails, and says so when the removal fails too", async () => {
    const fallo = cliente(base(), { data: null, error: { code: "55000", hint: "periodo_cerrado" } });
    expect(await registrar(fallo.client, input)).toEqual({ ok: false, error: e.periodoCerrado });
    expect(mocks.eliminar).toHaveBeenCalledWith(PATH);

    mocks.eliminar.mockResolvedValue(false);
    expect(await registrar(fallo.client, input)).toEqual({ ok: false, error: e.limpiezaFallo });
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain(EMPLEADO);
  });

  it("a receipt that appeared meanwhile turns into the replacement question, the file kept", async () => {
    const carrera = cliente(base(), { data: null, error: { code: "55000", hint: "requiere_reemplazo", details: "firmado" } });
    expect(await registrar(carrera.client, input)).toEqual({ ok: true, data: { estado: "confirmar_reemplazo", firmado: true } });
    expect(mocks.eliminar).not.toHaveBeenCalled();
  });
});

describe("descartar", () => {
  it("removes an unreferenced object and reports a failed removal", async () => {
    const { client } = cliente(sinReferencias);
    expect(await descartar(client, input)).toEqual({ ok: true });
    mocks.eliminar.mockResolvedValue(false);
    expect(await descartar(client, input)).toEqual({ ok: false, error: e.descarteFallo });
  });

  it("never removes an object a row holds, or a path of another employee", async () => {
    const enUso = cliente({ ...sinReferencias, recibo_historial: { data: [{ id: "h" }], error: null } });
    expect(await descartar(enUso.client, input)).toEqual({ ok: false, error: e.accionFallo });
    expect(await descartar(enUso.client, { ...input, empleadoId: PERIODO })).toEqual({ ok: false, error: e.accionFallo });
    expect(mocks.eliminar).not.toHaveBeenCalled();
  });
});
