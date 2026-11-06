import { describe, expect, it, vi } from "vitest";
import { PDFDocument, rgb, StandardFonts } from "@cantoo/pdf-lib";

vi.mock("server-only", () => ({}));

const { extraerTextoPdf, MAX_PAGINAS_DNI, patronDni, verificarDniEnPdf } = await import("./pdf-texto");

// Invented values only: no real DNI, CUIL or name.
const DNI = "12345678";
const DNI_7 = "7654321";

// A PDF whose pages carry the given lines (an empty list leaves a page blank).
async function pdfConTexto(paginas: string[][]): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  const font = await documento.embedFont(StandardFonts.Helvetica);
  for (const lineas of paginas) {
    const pagina = documento.addPage([595, 842]);
    lineas.forEach((linea, i) => pagina.drawText(linea, { x: 50, y: 780 - i * 20, size: 11, font }));
  }
  return documento.save();
}

async function pdfSinTexto(): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  documento.addPage([595, 842]).drawRectangle({ x: 50, y: 50, width: 200, height: 100, color: rgb(0.2, 0.2, 0.2) });
  return documento.save();
}

const recibo = (linea: string) => pdfConTexto([["RECIBO DE HABERES - EMPRESA DE PRUEBA", "Empleado: Persona Inventada", linea]]);

describe("verificarDniEnPdf: found", () => {
  it.each([
    ["plain", `DNI ${DNI}`],
    ["with dots", "DNI 12.345.678"],
    ["with spaces", "DNI 12 345 678"],
    ["inside a CUIL with hyphens", "CUIL 20-12345678-3"],
    ["at the start of the line", `${DNI} legajo 9`],
  ])("%s", async (_caso, linea) => {
    expect(await verificarDniEnPdf(await recibo(linea), DNI)).toEqual({ estado: "encontrado" });
  });

  it("a 7-digit DNI, plain and with dots", async () => {
    expect(await verificarDniEnPdf(await recibo(`DNI ${DNI_7}`), DNI_7)).toEqual({ estado: "encontrado" });
    expect(await verificarDniEnPdf(await recibo("DNI 7.654.321"), DNI_7)).toEqual({ estado: "encontrado" });
  });

  it("on page 2 of 3", async () => {
    const pdf = await pdfConTexto([["Hoja 1 de 3"], ["Hoja 2 de 3", `DNI ${DNI}`], ["Hoja 3 de 3"]]);
    expect(await verificarDniEnPdf(pdf, DNI)).toEqual({ estado: "encontrado" });
  });

  it("trims the stored DNI", async () => {
    expect(await verificarDniEnPdf(await recibo(`DNI ${DNI}`), ` ${DNI} `)).toEqual({ estado: "encontrado" });
  });
});

describe("verificarDniEnPdf: not found", () => {
  it.each([
    ["a different number", "DNI 87654321"],
    ["digits embedded after another digit", "Cuenta 112345678"],
    ["digits embedded before another digit", "Cuenta 123456789"],
    ["dotted, followed by a digit", "Ref 12.345.6789"],
    ["two separators between digits", "DNI 12..345.678"],
    ["a hyphen inside the number", "DNI 12-345-678"],
  ])("%s", async (_caso, linea) => {
    expect(await verificarDniEnPdf(await recibo(linea), DNI)).toEqual({ estado: "no_encontrado" });
  });

  it("does not join digits across two pages", async () => {
    const pdf = await pdfConTexto([["Total 1234"], ["5678 pesos"]]);
    expect(await verificarDniEnPdf(pdf, DNI)).toEqual({ estado: "no_encontrado" });
  });
});

describe("verificarDniEnPdf: sin_dni", () => {
  it.each([
    ["null", null],
    ["empty", ""],
    ["blank", "   "],
    ["too short", "123456"],
    ["too long", "123456789"],
    ["not digits", "12.345.678"],
  ])("%s, without reading the file", async (_caso, dni) => {
    // Not a PDF: proves the file is not parsed.
    expect(await verificarDniEnPdf(new Uint8Array([1, 2, 3]), dni)).toEqual({ estado: "sin_dni" });
  });
});

describe("verificarDniEnPdf: no_verificable", () => {
  it("sin_texto for a PDF with only a drawn rectangle", async () => {
    expect(await verificarDniEnPdf(await pdfSinTexto(), DNI)).toEqual({ estado: "no_verificable", motivo: "sin_texto" });
  });

  it("sin_texto for blank pages", async () => {
    expect(await verificarDniEnPdf(await pdfConTexto([[], []]), DNI)).toEqual({ estado: "no_verificable", motivo: "sin_texto" });
  });

  it("ilegible for random bytes", async () => {
    const bytes = new Uint8Array(4096).map((_, i) => (i * 7919 + 13) % 256);
    expect(await verificarDniEnPdf(bytes, DNI)).toEqual({ estado: "no_verificable", motivo: "ilegible" });
  });

  it("ilegible for a truncated PDF", async () => {
    const pdf = await recibo(`DNI ${DNI}`);
    expect(await verificarDniEnPdf(pdf.slice(0, 40), DNI)).toEqual({ estado: "no_verificable", motivo: "ilegible" });
  });

  it("ilegible for an encrypted PDF", async () => {
    const documento = await PDFDocument.create();
    documento.addPage().drawText(`DNI ${DNI}`);
    documento.encrypt({ userPassword: "clave-de-prueba", ownerPassword: "otra-clave-de-prueba" });
    expect(await verificarDniEnPdf(await documento.save(), DNI)).toEqual({ estado: "no_verificable", motivo: "ilegible" });
  });

  it(`demasiado_grande for ${MAX_PAGINAS_DNI + 1} pages, and ${MAX_PAGINAS_DNI} pages are read`, async () => {
    const paginas = (n: number) => Array.from({ length: n }, (_, i) => [`Hoja ${i + 1}`, `DNI ${DNI}`]);
    expect(await verificarDniEnPdf(await pdfConTexto(paginas(MAX_PAGINAS_DNI + 1)), DNI)).toEqual({
      estado: "no_verificable",
      motivo: "demasiado_grande",
    });
    expect(await verificarDniEnPdf(await pdfConTexto(paginas(MAX_PAGINAS_DNI)), DNI)).toEqual({ estado: "encontrado" });
  });
});

describe("extraerTextoPdf", () => {
  it("returns the text of each page and leaves the input untouched", async () => {
    const pdf = await pdfConTexto([["Primera hoja"], ["Segunda hoja, con ñ y acentos: áéíóú"]]);
    const copia = pdf.slice();
    const texto = await extraerTextoPdf(pdf);
    expect(texto.ok).toBe(true);
    if (!texto.ok) return;
    expect(texto.paginas).toHaveLength(2);
    expect(texto.paginas[0]).toContain("Primera hoja");
    expect(texto.paginas[1]).toContain("Segunda hoja, con ñ y acentos: áéíóú");
    expect(pdf).toEqual(copia);
  });
});

describe("patronDni", () => {
  it("allows one optional dot or whitespace between digits, and no digit around", () => {
    const patron = patronDni(DNI)!;
    for (const texto of ["12345678", "12.345.678", "12 345 678", "1 2 3 4 5 6 7 8", "20-12345678-3", "x12345678x"]) {
      expect(patron.test(texto), texto).toBe(true);
    }
    for (const texto of ["112345678", "123456789", "1234567", "12-345-678", "12. 345.678"]) {
      expect(patron.test(texto), texto).toBe(false);
    }
  });
});
