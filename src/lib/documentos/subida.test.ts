import { describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { subirDocumento, type SubidaPasos } from "./subida";

const PATH = "11111111-1111-4111-8111-111111111111/dni_frente/22222222-2222-4222-8222-222222222222.pdf";
const FILE = { name: "dni.pdf", type: "application/pdf", size: 100 };
const errors = copy.miLegajo.documentos.errors;

function pasos(overrides: Partial<SubidaPasos> = {}) {
  const base: SubidaPasos = {
    preparar: vi.fn(async () => ({ ok: true as const, data: { path: PATH } })),
    subirArchivo: vi.fn(async () => ({ error: null })),
    registrar: vi.fn(async () => ({ ok: true as const, data: { estado: "pendiente" } })),
    descartar: vi.fn(async () => ({ ok: true as const })),
  };
  return { ...base, ...overrides };
}

describe("subirDocumento (browser flow)", () => {
  it("succeeds without discarding anything", async () => {
    const p = pasos();
    await expect(subirDocumento(p, "dni_frente", FILE)).resolves.toBeNull();
    expect(p.descartar).not.toHaveBeenCalled();
  });

  it("discards the object and ends with an error when registration throws", async () => {
    const p = pasos({ registrar: vi.fn(async () => Promise.reject(new Error("network down"))) });
    await expect(subirDocumento(p, "dni_frente", FILE)).resolves.toBe(errors.subirFallo);
    expect(p.descartar).toHaveBeenCalledWith({ path: PATH });
  });

  it("discards the object and shows the server's error when registration fails", async () => {
    const p = pasos({ registrar: vi.fn(async () => ({ ok: false as const, error: "Motivo del servidor" })) });
    await expect(subirDocumento(p, "dni_frente", FILE)).resolves.toBe("Motivo del servidor");
    expect(p.descartar).toHaveBeenCalledWith({ path: PATH });
  });

  it("surfaces a failed discard instead of hiding it", async () => {
    const p = pasos({
      registrar: vi.fn(async () => Promise.reject(new Error("x"))),
      descartar: vi.fn(async () => ({ ok: false as const, error: errors.limpiezaFallo })),
    });
    await expect(subirDocumento(p, "dni_frente", FILE)).resolves.toBe(errors.limpiezaFallo);
    const throws = pasos({
      registrar: vi.fn(async () => Promise.reject(new Error("x"))),
      descartar: vi.fn(async () => Promise.reject(new Error("y"))),
    });
    await expect(subirDocumento(throws, "dni_frente", FILE)).resolves.toBe(errors.limpiezaFallo);
  });

  it("has nothing to discard when the file never reached Storage", async () => {
    const p = pasos({ subirArchivo: vi.fn(async () => ({ error: { message: "x" } })) });
    await expect(subirDocumento(p, "dni_frente", FILE)).resolves.toBe(errors.subirFallo);
    expect(p.registrar).not.toHaveBeenCalled();
    expect(p.descartar).not.toHaveBeenCalled();
  });

  it("returns the preparation error and never throws", async () => {
    const p = pasos({ preparar: vi.fn(async () => ({ ok: false as const, error: "Ya hay uno pendiente" })) });
    await expect(subirDocumento(p, "dni_frente", FILE)).resolves.toBe("Ya hay uno pendiente");
    const t = pasos({ preparar: vi.fn(async () => Promise.reject(new Error("x"))) });
    await expect(subirDocumento(t, "dni_frente", FILE)).resolves.toBe(errors.subirFallo);
  });
});
