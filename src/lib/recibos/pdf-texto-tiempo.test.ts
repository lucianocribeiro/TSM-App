import { afterEach, describe, expect, it, vi } from "vitest";

// The 5-second limit, with pdf.js replaced by an extraction that never ends
// and fake timers (no real wait).

const destruir = vi.fn(async () => undefined);

vi.mock("server-only", () => ({}));
vi.mock("unpdf", () => ({
  getResolvedPDFJS: async () => ({
    getDocument: () => ({ promise: new Promise(() => undefined), destroy: destruir }),
  }),
  extractText: async () => ({ totalPages: 0, text: [] }),
}));

const { TIEMPO_MAXIMO_DNI_MS, verificarDniEnPdf } = await import("./pdf-texto");

afterEach(() => {
  vi.useRealTimers();
  destruir.mockClear();
});

describe("verificarDniEnPdf: time limit", () => {
  it("returns tiempo_agotado after the limit and stops the extraction", async () => {
    vi.useFakeTimers();
    let terminado = false;
    const resultado = verificarDniEnPdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "12345678").then((r) => {
      terminado = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(TIEMPO_MAXIMO_DNI_MS - 1);
    expect(terminado).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await resultado).toEqual({ estado: "no_verificable", motivo: "tiempo_agotado" });
    expect(destruir).toHaveBeenCalledTimes(1);
  });

  it("the limit is 5 seconds", () => {
    expect(TIEMPO_MAXIMO_DNI_MS).toBe(5_000);
  });
});
