import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import {
  DOCUMENTO_MIME_LIST,
  DOCUMENTO_TIPOS,
  isDocumentoTipo,
  MAX_DOCUMENTO_BYTES,
} from "./tipos";
import { MAX_FILE_NAME_LENGTH, validateDocumentoUpload } from "./validation";

const m = copy.documentos.validation;

function input(overrides: Partial<Parameters<typeof validateDocumentoUpload>[0]> = {}) {
  return {
    tipo: "dni_frente",
    fileName: "dni-frente.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    ...overrides,
  };
}

describe("document types", () => {
  it("defines DNI frente and dorso as required and licencia as optional", () => {
    expect(DOCUMENTO_TIPOS.map(({ tipo, required }) => [tipo, required])).toEqual([
      ["dni_frente", true],
      ["dni_dorso", true],
      ["licencia_conducir", false],
    ]);
  });

  it("has a copy label for every type", () => {
    for (const { labelKey } of DOCUMENTO_TIPOS) {
      expect(copy.documentos.tipos[labelKey].trim()).not.toBe("");
    }
  });

  it("recognizes only the three codes", () => {
    expect(isDocumentoTipo("dni_dorso")).toBe(true);
    expect(isDocumentoTipo("pasaporte")).toBe(false);
    expect(isDocumentoTipo(undefined)).toBe(false);
  });

  it("uses a 10 MB limit and the three allowed MIME types", () => {
    expect(MAX_DOCUMENTO_BYTES).toBe(10485760);
    expect(DOCUMENTO_MIME_LIST).toEqual(["application/pdf", "image/jpeg", "image/png"]);
  });
});

describe("validateDocumentoUpload", () => {
  it("accepts PDF, JPG, JPEG and PNG with matching MIME types", () => {
    const cases = [
      ["a.pdf", "application/pdf"],
      ["a.jpg", "image/jpeg"],
      ["a.JPEG", "image/jpeg"],
      ["foto.dni.png", "image/png"],
    ] as const;
    for (const [fileName, mimeType] of cases) {
      const result = validateDocumentoUpload(input({ fileName, mimeType }));
      expect(result, fileName).toEqual({
        ok: true,
        data: { tipo: "dni_frente", fileName, mimeType, sizeBytes: 1024 },
      });
    }
  });

  it("trims the file name", () => {
    const result = validateDocumentoUpload(input({ fileName: "  dni.pdf  " }));
    expect(result.ok && result.data.fileName).toBe("dni.pdf");
  });

  it("rejects an invalid type", () => {
    expect(validateDocumentoUpload(input({ tipo: "pasaporte" }))).toEqual({ ok: false, error: m.tipoInvalid });
    expect(validateDocumentoUpload(input({ tipo: null }))).toEqual({ ok: false, error: m.tipoInvalid });
  });

  it("rejects a missing file name", () => {
    for (const fileName of [null, undefined, "", "   "]) {
      expect(validateDocumentoUpload(input({ fileName }))).toEqual({ ok: false, error: m.fileRequired });
    }
  });

  it("rejects a file name that is too long", () => {
    const fileName = `${"a".repeat(MAX_FILE_NAME_LENGTH)}.pdf`;
    expect(validateDocumentoUpload(input({ fileName }))).toEqual({ ok: false, error: m.fileNameTooLong });
  });

  it("rejects empty or invalid sizes", () => {
    for (const sizeBytes of [0, -1, 1.5, Number.NaN, null, undefined]) {
      expect(validateDocumentoUpload(input({ sizeBytes })), String(sizeBytes)).toEqual({ ok: false, error: m.fileEmpty });
    }
  });

  it("accepts exactly 10 MB and rejects one byte more", () => {
    expect(validateDocumentoUpload(input({ sizeBytes: MAX_DOCUMENTO_BYTES })).ok).toBe(true);
    expect(validateDocumentoUpload(input({ sizeBytes: MAX_DOCUMENTO_BYTES + 1 }))).toEqual({
      ok: false,
      error: m.fileTooLarge,
    });
  });

  it("rejects MIME types and extensions that are not allowed", () => {
    const cases = [
      ["a.html", "text/html"],
      ["a.pdf", "text/html"],
      ["a.gif", "image/gif"],
      ["a.exe", "application/pdf"],
      ["sin-extension", "application/pdf"],
      [".pdf", "application/pdf"],
      ["a.", "application/pdf"],
      ["a.pdf", null],
    ] as const;
    for (const [fileName, mimeType] of cases) {
      expect(validateDocumentoUpload(input({ fileName, mimeType })), fileName).toEqual({
        ok: false,
        error: m.fileTypeNotAllowed,
      });
    }
  });

  it("rejects an extension that does not match the MIME type", () => {
    const cases = [
      ["a.pdf", "image/png"],
      ["a.png", "image/jpeg"],
      ["a.jpg", "application/pdf"],
    ] as const;
    for (const [fileName, mimeType] of cases) {
      expect(validateDocumentoUpload(input({ fileName, mimeType })), fileName).toEqual({
        ok: false,
        error: m.fileTypeMismatch,
      });
    }
  });
});

describe("signed-url helper", () => {
  it("uses the session-bound server client, never the service-role client", () => {
    const source = readFileSync(new URL("./signed-url.ts", import.meta.url), "utf8");
    expect(source).toContain('from "@/lib/supabase/server"');
    expect(source).not.toMatch(/supabase\/admin|createAdminClient|SERVICE_ROLE/i);
  });
});
