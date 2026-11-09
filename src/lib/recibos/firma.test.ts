import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyMisRecibos } from "@/lib/copy/mis-recibos";
import { copyRecibosServidor } from "@/lib/copy/recibos-servidor";

// The Mis Recibos server logic with storage, the stamp and the database
// replaced: the signing sequence and its cleanup on every failure path,
// the one signing time (decision 10), the stamp name (decision 12), the
// signature image checks and the download name. End to end against the
// local stack: tests/integration/mis-recibos-acciones.test.ts.

const mocks = vi.hoisted(() => ({
  descargarRecibo: vi.fn(),
  descargarFirma: vi.fn(),
  subirRecibo: vi.fn(),
  eliminarRecibo: vi.fn(),
  eliminarFirma: vi.fn(),
  barrer: vi.fn(),
  urlSubidaFirma: vi.fn(),
  estampar: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./cliente-privilegiado", () => ({
  descargarRecibo: (...a: unknown[]) => mocks.descargarRecibo(...a),
  descargarFirma: (...a: unknown[]) => mocks.descargarFirma(...a),
  subirRecibo: (...a: unknown[]) => mocks.subirRecibo(...a),
  eliminarRecibo: (...a: unknown[]) => mocks.eliminarRecibo(...a),
  eliminarFirma: (...a: unknown[]) => mocks.eliminarFirma(...a),
  barrerHuerfanos: (...a: unknown[]) => mocks.barrer(...a),
  crearUrlSubidaFirmaPrivilegiada: (...a: unknown[]) => mocks.urlSubidaFirma(...a),
}));
vi.mock("./pdf-firma", () => ({
  EstampaError: class extends Error {},
  estamparFirma: (...a: unknown[]) => mocks.estampar(...a),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const { firmar, medidasAceptables, medidasPng, mensajeDeFirmar, nombreDescarga, nombreParaEstampa, prepararFirma, registrarFirma } =
  await import("./firma");

const e = copyMisRecibos.errors;
const YO = "22222222-2222-4222-8222-222222222222";
const OTRO = "55555555-5555-4555-8555-555555555555";
const PERIODO = "33333333-3333-4333-8333-333333333333";
const RECIBO = "66666666-6666-4666-8666-666666666666";
const VIEJO = `${YO}/${PERIODO}/44444444-4444-4444-8444-444444444444.pdf`;
const FIRMA_PATH = `${YO}/1-77777777-7777-4777-8777-777777777777.png`;
const AHORA = new Date("2026-11-09T18:30:00.000Z");

// A PNG header with the given size (signature, IHDR length and type, width, height).
function pngDe(ancho: number, alto: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const vista = new DataView(bytes.buffer);
  vista.setUint32(16, ancho);
  vista.setUint32(20, alto);
  return bytes;
}

type Respuesta = { data: unknown; error: unknown };
function cliente(tablas: Record<string, Respuesta>, rpc: Respuesta = { data: VIEJO, error: null }) {
  const llamadas: unknown[][] = [];
  const vacia = { data: null, error: null };
  const consulta = (tabla: string) => {
    const cadena: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "limit", "order", "in"]) cadena[metodo] = () => cadena;
    cadena.maybeSingle = async () => tablas[`${tabla}:una`] ?? tablas[tabla] ?? vacia;
    cadena.then = (ok: (r: Respuesta) => unknown) => Promise.resolve(tablas[`${tabla}:lista`] ?? tablas[tabla] ?? vacia).then(ok);
    return cadena;
  };
  return {
    client: {
      from: consulta,
      rpc: async (...args: unknown[]) => {
        llamadas.push(args);
        return rpc;
      },
    } as never,
    llamadas,
  };
}

const pendiente = { id: RECIBO, periodo_id: PERIODO, archivo_path: VIEJO, estado: "pendiente", recibo_periodos: { anio: 2026, mes: 10 } };
const tablasFirmar = (extra: Record<string, Respuesta> = {}) => ({
  recibos: { data: pendiente, error: null },
  firmas_empleado: { data: { imagen_path: FIRMA_PATH }, error: null },
  legajos: { data: { nombres: "Ana", apellido: "Prueba" }, error: null },
  ...extra,
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.descargarRecibo.mockResolvedValue({ ok: true, bytes: new Uint8Array([1]), mimeType: "application/pdf" });
  mocks.descargarFirma.mockResolvedValue({ ok: true, bytes: pngDe(600, 180), mimeType: "image/png" });
  mocks.subirRecibo.mockResolvedValue(true);
  mocks.eliminarRecibo.mockResolvedValue(true);
  mocks.eliminarFirma.mockResolvedValue(true);
  mocks.barrer.mockResolvedValue({ ok: true, eliminados: 0 });
  mocks.estampar.mockResolvedValue(new Uint8Array([1, 2, 3]));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("firmar", () => {
  it("stamps and records the same server time, stores the signed PDF at a new path, then removes the unsigned file", async () => {
    const { client, llamadas } = cliente(tablasFirmar());
    expect(await firmar(client, YO, { reciboId: RECIBO }, () => AHORA)).toEqual({
      ok: true,
      data: { estado: "firmado", firmadoAt: AHORA.toISOString() },
    });
    const [, , datos] = mocks.estampar.mock.calls[0];
    expect(datos).toEqual({ nombre: "Ana Prueba", firmadoEn: AHORA });
    const [nuevo] = mocks.subirRecibo.mock.calls[0];
    expect(nuevo).toMatch(new RegExp(`^${YO}/${PERIODO}/[0-9a-f-]{36}\\.pdf$`));
    expect(nuevo).not.toBe(VIEJO);
    expect(llamadas[0]).toEqual([
      "recibo_firmar",
      { p_recibo_id: RECIBO, p_archivo_path: nuevo, p_archivo_bytes: 3, p_firmado_at: AHORA.toISOString() },
    ]);
    // The unsigned file goes only after the function committed.
    expect(mocks.eliminarRecibo.mock.calls).toEqual([[VIEJO]]);
    expect(mocks.subirRecibo.mock.invocationCallOrder[0]).toBeLessThan(mocks.eliminarRecibo.mock.invocationCallOrder[0]);
  });

  it("keeps the unsigned file when a history row or override holds it (the function returns null)", async () => {
    const { client } = cliente(tablasFirmar(), { data: null, error: null });
    expect((await firmar(client, YO, { reciboId: RECIBO }, () => AHORA)).ok).toBe(true);
    expect(mocks.eliminarRecibo).not.toHaveBeenCalled();
  });

  it("a failed removal of the unsigned file still is a signed receipt, logged without ids", async () => {
    mocks.eliminarRecibo.mockResolvedValue(false);
    const { client } = cliente(tablasFirmar());
    expect(await firmar(client, YO, { reciboId: RECIBO }, () => AHORA)).toMatchObject({ ok: true, data: { estado: "firmado" } });
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain(YO);
  });

  it("a refused signing removes the signed file and maps the hint; a failed removal is reported, never success", async () => {
    const yaFirmado = cliente(tablasFirmar(), { data: null, error: { code: "55000", hint: "recibo_ya_firmado" } });
    expect(await firmar(yaFirmado.client, YO, { reciboId: RECIBO }, () => AHORA)).toEqual({ ok: false, error: e.yaFirmado });
    const [nuevo] = mocks.subirRecibo.mock.calls[0];
    expect(mocks.eliminarRecibo.mock.calls).toEqual([[nuevo]]);

    mocks.eliminarRecibo.mockResolvedValue(false);
    expect(await firmar(yaFirmado.client, YO, { reciboId: RECIBO }, () => AHORA)).toEqual({ ok: false, error: e.limpiezaFallo });
  });

  it("without an active signature asks for the drawing first, touching nothing", async () => {
    const { client, llamadas } = cliente(tablasFirmar({ firmas_empleado: { data: null, error: null } }));
    expect(await firmar(client, YO, { reciboId: RECIBO })).toEqual({ ok: true, data: { estado: "sin_firma" } });
    expect(mocks.subirRecibo).not.toHaveBeenCalled();
    expect(llamadas).toEqual([]);
  });

  it("refuses a missing, foreign or signed receipt before any file work", async () => {
    const ninguno = cliente(tablasFirmar({ recibos: { data: null, error: null } }));
    expect(await firmar(ninguno.client, YO, { reciboId: RECIBO })).toEqual({ ok: false, error: e.noEncontrado });
    const firmado = cliente(tablasFirmar({ recibos: { data: { ...pendiente, estado: "firmado" }, error: null } }));
    expect(await firmar(firmado.client, YO, { reciboId: RECIBO })).toEqual({ ok: false, error: e.yaFirmado });
    expect(mocks.descargarRecibo).not.toHaveBeenCalled();
  });

  it("a stamp or upload failure leaves nothing in the database", async () => {
    mocks.estampar.mockRejectedValue(new Error("x"));
    const sello = cliente(tablasFirmar());
    expect(await firmar(sello.client, YO, { reciboId: RECIBO })).toEqual({ ok: false, error: e.firmarFallo });
    mocks.estampar.mockResolvedValue(new Uint8Array([1]));
    mocks.subirRecibo.mockResolvedValue(false);
    const subida = cliente(tablasFirmar());
    expect(await firmar(subida.client, YO, { reciboId: RECIBO })).toEqual({ ok: false, error: e.firmarFallo });
    expect(sello.llamadas).toEqual([]);
    expect(subida.llamadas).toEqual([]);
  });
});

describe("registrarFirma", () => {
  const sinUso = { firmas_empleado: { data: [], error: null } };

  it("registers a PNG of sane size in the caller's own folder", async () => {
    const { client, llamadas } = cliente(sinUso, { data: 1, error: null });
    expect(await registrarFirma(client, YO, { path: FIRMA_PATH })).toEqual({ ok: true, data: { version: 1 } });
    expect(llamadas[0]).toEqual(["firma_registrar", { p_imagen_path: FIRMA_PATH }]);
  });

  it("refuses another employee's path without touching it", async () => {
    const { client } = cliente(sinUso);
    expect(await registrarFirma(client, YO, { path: FIRMA_PATH.replace(YO, OTRO) })).toEqual({ ok: false, error: e.firmaFallo });
    expect(mocks.eliminarFirma).not.toHaveBeenCalled();
  });

  it("removes the object for bad content or size, and reports a failed removal", async () => {
    mocks.descargarFirma.mockResolvedValue({ ok: true, bytes: pngDe(50, 20), mimeType: "image/png" });
    const { client } = cliente(sinUso);
    expect(await registrarFirma(client, YO, { path: FIRMA_PATH })).toEqual({ ok: false, error: e.firmaMedidas });
    mocks.descargarFirma.mockResolvedValue({ ok: true, bytes: new TextEncoder().encode("no es un png"), mimeType: "image/png" });
    expect(await registrarFirma(client, YO, { path: FIRMA_PATH })).toEqual({ ok: false, error: e.firmaContenido });
    expect(mocks.eliminarFirma).toHaveBeenCalledTimes(2);
    mocks.eliminarFirma.mockResolvedValue(false);
    expect(await registrarFirma(client, YO, { path: FIRMA_PATH })).toEqual({ ok: false, error: e.firmaLimpiezaFallo });
  });
});

describe("prepararFirma", () => {
  it("refuses a declared non-PNG or a file over 1 MB, and builds the next version path", async () => {
    const { client } = cliente({ firmas_empleado: { data: [{ version: 2 }], error: null } });
    expect(await prepararFirma(client, YO, { tamano: 100, tipo: "image/jpeg" })).toEqual({ ok: false, error: e.firmaTipo });
    expect(await prepararFirma(client, YO, { tamano: 1024 * 1024 + 1, tipo: "image/png" })).toEqual({ ok: false, error: e.firmaMuyGrande });
    mocks.urlSubidaFirma.mockResolvedValue({ ok: true, token: "tok", path: "x", url: "u" });
    const result = await prepararFirma(client, YO, { tamano: 100, tipo: "image/png" });
    expect(result.ok && result.data?.path).toMatch(new RegExp(`^${YO}/3-[0-9a-f-]{36}\\.png$`));
  });
});

describe("pure helpers", () => {
  it("reads PNG dimensions and checks the bounds", () => {
    expect(medidasPng(pngDe(600, 180))).toEqual({ ancho: 600, alto: 180 });
    expect(medidasPng(new Uint8Array(10))).toBeNull();
    expect(medidasAceptables({ ancho: 100, alto: 40 })).toBe(true);
    expect(medidasAceptables({ ancho: 2000, alto: 1000 })).toBe(true);
    expect(medidasAceptables({ ancho: 99, alto: 40 })).toBe(false);
    expect(medidasAceptables({ ancho: 2001, alto: 100 })).toBe(false);
    expect(medidasAceptables(null)).toBe(false);
  });

  it("names the download Recibo-MM-AAAA.pdf", () => {
    expect(nombreDescarga({ anio: 2026, mes: 3 })).toBe("Recibo-03-2026.pdf");
  });

  it("maps every recibo_firmar hint; a missing and a foreign receipt read the same", () => {
    expect(mensajeDeFirmar({ hint: "recibo_ajeno" })).toBe(e.noEncontrado);
    expect(mensajeDeFirmar({ hint: "periodo_no_visible" })).toBe(e.noEncontrado);
    expect(mensajeDeFirmar({ hint: "recibo_ya_firmado" })).toBe(e.yaFirmado);
    expect(mensajeDeFirmar({ hint: "hora_invalida" })).toBe(e.horaInvalida);
    expect(mensajeDeFirmar({ hint: "archivo_repetido" })).toBe(e.firmarFallo);
    expect(mensajeDeFirmar(null)).toBe(e.firmarFallo);
  });

  it("stamps the legajo's name, else the fixed text; never an id or email", () => {
    expect(nombreParaEstampa({ nombres: "Ana", apellido: "Prueba" })).toBe("Ana Prueba");
    expect(nombreParaEstampa({ nombres: null, apellido: " " })).toBe(copyRecibosServidor.nombreSinLegajo);
    expect(nombreParaEstampa(null)).toBe(copyRecibosServidor.nombreSinLegajo);
  });
});
