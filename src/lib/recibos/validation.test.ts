import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { validarFirmaDeclarada, validarFirmaImagen, validarReciboArchivo, validarReciboDeclarado } = await import("./validation");
const { MAX_FIRMA_BYTES, MAX_RECIBO_BYTES } = await import("./tipos");

const PDF = "application/pdf";
const PNG = "image/png";
const pdf = (resto = "1.7 contenido") => new TextEncoder().encode(`%PDF-${resto}`);
const png = (largo = 64) => {
  const bytes = new Uint8Array(largo);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};
const relleno = (cabecera: Uint8Array, largo: number) => {
  const bytes = new Uint8Array(largo);
  bytes.set(cabecera);
  return bytes;
};

describe("limits", () => {
  it("are 10 MB for receipts and 1 MB for signatures", () => {
    expect(MAX_RECIBO_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_FIRMA_BYTES).toBe(1024 * 1024);
  });
});

describe("receipt files", () => {
  it("accepts a PDF up to 10 MB", () => {
    expect(validarReciboArchivo({ mimeType: PDF, bytes: pdf() })).toEqual({ ok: true });
    expect(validarReciboArchivo({ mimeType: PDF, bytes: relleno(pdf(), MAX_RECIBO_BYTES) })).toEqual({ ok: true });
  });

  it("refuses wrong magic bytes, even declared as PDF", () => {
    expect(validarReciboArchivo({ mimeType: PDF, bytes: new TextEncoder().encode("<html>%PDF-") })).toEqual({ ok: false, motivo: "contenido" });
    expect(validarReciboArchivo({ mimeType: PDF, bytes: png() })).toEqual({ ok: false, motivo: "contenido" });
    expect(validarReciboArchivo({ mimeType: PDF, bytes: new TextEncoder().encode("%PD") })).toEqual({ ok: false, motivo: "contenido" });
  });

  it("refuses more than 10 MB", () => {
    expect(validarReciboArchivo({ mimeType: PDF, bytes: relleno(pdf(), MAX_RECIBO_BYTES + 1) })).toEqual({ ok: false, motivo: "muy-grande" });
    expect(validarReciboDeclarado({ mimeType: PDF, sizeBytes: MAX_RECIBO_BYTES + 1 })).toEqual({ ok: false, motivo: "muy-grande" });
  });

  it("refuses another MIME type", () => {
    expect(validarReciboArchivo({ mimeType: PNG, bytes: pdf() })).toEqual({ ok: false, motivo: "tipo" });
    expect(validarReciboDeclarado({ mimeType: "application/x-pdf", sizeBytes: 10 })).toEqual({ ok: false, motivo: "tipo" });
    expect(validarReciboDeclarado({ mimeType: undefined, sizeBytes: 10 })).toEqual({ ok: false, motivo: "tipo" });
  });

  it("refuses an empty file or a size that is not a positive integer", () => {
    expect(validarReciboArchivo({ mimeType: PDF, bytes: new Uint8Array() })).toEqual({ ok: false, motivo: "vacio" });
    for (const sizeBytes of [0, -1, 1.5, "10", null]) {
      expect(validarReciboDeclarado({ mimeType: PDF, sizeBytes }), String(sizeBytes)).toEqual({ ok: false, motivo: "vacio" });
    }
  });
});

describe("signature images", () => {
  it("accepts a PNG up to 1 MB", () => {
    expect(validarFirmaImagen({ mimeType: PNG, bytes: png() })).toEqual({ ok: true });
    expect(validarFirmaImagen({ mimeType: PNG, bytes: png(MAX_FIRMA_BYTES) })).toEqual({ ok: true });
    expect(validarFirmaDeclarada({ mimeType: PNG, sizeBytes: MAX_FIRMA_BYTES })).toEqual({ ok: true });
  });

  it("refuses more than 1 MB", () => {
    expect(validarFirmaImagen({ mimeType: PNG, bytes: png(MAX_FIRMA_BYTES + 1) })).toEqual({ ok: false, motivo: "muy-grande" });
    expect(validarFirmaDeclarada({ mimeType: PNG, sizeBytes: MAX_FIRMA_BYTES + 1 })).toEqual({ ok: false, motivo: "muy-grande" });
  });

  it("refuses wrong magic bytes and another MIME type", () => {
    expect(validarFirmaImagen({ mimeType: PNG, bytes: pdf() })).toEqual({ ok: false, motivo: "contenido" });
    expect(validarFirmaImagen({ mimeType: "image/jpeg", bytes: png() })).toEqual({ ok: false, motivo: "tipo" });
    expect(validarFirmaDeclarada({ mimeType: "image/svg+xml", sizeBytes: 10 })).toEqual({ ok: false, motivo: "tipo" });
  });
});
