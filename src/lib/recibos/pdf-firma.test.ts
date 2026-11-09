import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, type PDFPage } from "@cantoo/pdf-lib";
import { getDocumentProxy } from "unpdf";

vi.mock("server-only", () => ({}));

const { estamparFirma, EstampaError, fechaHoraArgentina, MARGEN_DERECHO_PT, MARGEN_INFERIOR_PT, medidaFirma, textoRepresentable } =
  await import("./pdf-firma");
const { extraerTextoPdf } = await import("./pdf-texto");

// Invented names only.
const NOMBRE = "Íñigo Peña Muñoz";
// 2026-03-01 02:30 UTC is 28/02/2026 23:30 in Buenos Aires (UTC-3).
const FIRMADO_EN = new Date("2026-03-01T02:30:00Z");
const LINEA = `Firmado electrónicamente por ${NOMBRE} el 28/02/2026 a las 23:30 (hora de Argentina)`;

// A valid RGBA PNG of the given size, made here (no binary fixture).
function png(ancho: number, alto: number): Uint8Array {
  const trozo = (tipo: string, datos: Buffer) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo));
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(ancho, 0);
  cabecera.writeUInt32BE(alto, 4);
  cabecera.set([8, 6, 0, 0, 0], 8);
  const fila = Buffer.concat([Buffer.from([0]), Buffer.alloc(ancho * 4, 0x40)]);
  const pixeles = Buffer.concat(Array.from({ length: alto }, () => fila));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", cabecera),
    trozo("IDAT", deflateSync(pixeles)),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

const FIRMA = png(300, 100);

type OpcionesUltima = { giro?: number; recorte?: [number, number, number, number] };

// Three text pages; the last one optionally rotated and cropped.
async function recibo(opciones: OpcionesUltima = {}, paginas = 3): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  const font = await documento.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= paginas; i++) {
    const pagina = documento.addPage([595, 842]);
    pagina.drawText(`Hoja ${i} de ${paginas} - recibo de prueba`, { x: 60, y: 700, size: 12, font });
  }
  const ultima = documento.getPages().at(-1)!;
  if (opciones.giro) ultima.setRotation(degrees(opciones.giro));
  if (opciones.recorte) ultima.setCropBox(...opciones.recorte);
  return documento.save();
}

const estampar = (pdf: Uint8Array, nombre = NOMBRE) => estamparFirma(pdf, FIRMA, { nombre, firmadoEn: FIRMADO_EN });

// The page's content stream bytes, as stored.
function contenidos(pagina: PDFPage): string[] {
  const valor = pagina.node.Contents();
  const streams = valor instanceof PDFArray ? valor.asArray().map((ref) => pagina.doc.context.lookup(ref)) : [valor];
  return streams.map((stream) => (stream instanceof PDFRawStream ? Buffer.from(stream.getContents()).toString("base64") : String(stream)));
}

function imagenes(pagina: PDFPage): number {
  const xobjects = pagina.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return 0;
  return xobjects.keys().filter((clave) => {
    const objeto = xobjects.lookup(clave);
    return objeto instanceof PDFRawStream && objeto.dict.get(PDFName.of("Subtype")) === PDFName.of("Image");
  }).length;
}

// Where the stamp line ends up on the page as displayed (origin top left).
async function posicionLinea(pdf: Uint8Array) {
  const documento = await getDocumentProxy(pdf.slice(), { verbosity: 0 });
  const pagina = await documento.getPage(documento.numPages);
  const vista = pagina.getViewport({ scale: 1 });
  const { items } = await pagina.getTextContent();
  const item = items.find((i) => "str" in i && i.str.startsWith("Firmado"));
  if (!item || !("str" in item)) throw new Error("stamp line not found");
  const [x, y] = vista.convertToViewportPoint(item.transform[4], item.transform[5]);
  const [finX, finY] = vista.convertToViewportPoint(
    item.transform[4] + (item.width * item.transform[0]) / Math.hypot(item.transform[0], item.transform[1]),
    item.transform[5] + (item.width * item.transform[1]) / Math.hypot(item.transform[0], item.transform[1]),
  );
  await documento.loadingTask.destroy();
  return { x, y, finX, finY, ancho: vista.width, alto: vista.height };
}

describe("estamparFirma", () => {
  it("keeps the page count and leaves the input untouched", async () => {
    const pdf = await recibo();
    const copia = pdf.slice();
    const salida = await estampar(pdf);
    expect((await PDFDocument.load(salida)).getPageCount()).toBe(3);
    expect(pdf).toEqual(copia);
  });

  it("keeps the signature's transparency: the RGBA image is embedded with an SMask (F2-05-FIX-01)", async () => {
    const documento = await PDFDocument.load(await estampar(await recibo()));
    const xobjects = documento.getPages().at(-1)!.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
    const imagenes = xobjects
      .keys()
      .map((clave) => xobjects.lookup(clave))
      .filter((objeto): objeto is PDFRawStream => objeto instanceof PDFRawStream && objeto.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
    expect(imagenes).toHaveLength(1);
    const mascara = imagenes[0].dict.lookup(PDFName.of("SMask"));
    expect(mascara).toBeInstanceOf(PDFRawStream);
    expect((mascara as PDFRawStream).dict.get(PDFName.of("Subtype"))).toBe(PDFName.of("Image"));
  });

  it("adds the image and the text to the last page only", async () => {
    const pdf = await recibo();
    const salida = await estampar(pdf);
    const antes = await PDFDocument.load(pdf);
    const despues = await PDFDocument.load(salida);
    const paginasAntes = antes.getPages();
    const paginasDespues = despues.getPages();

    for (const i of [0, 1]) {
      expect(contenidos(paginasDespues[i]), `page ${i + 1} content`).toEqual(contenidos(paginasAntes[i]));
      expect(imagenes(paginasDespues[i])).toBe(0);
    }
    expect(imagenes(paginasDespues[2])).toBe(1);
    // The last page keeps its streams (pdf-lib wraps them in q/Q before
    // drawing) and gets new ones for the stamp.
    expect(contenidos(paginasDespues[2])).toEqual(expect.arrayContaining(contenidos(paginasAntes[2])));
    expect(contenidos(paginasDespues[2]).length).toBeGreaterThan(contenidos(paginasAntes[2]).length);

    const texto = await extraerTextoPdf(salida);
    const textoAntes = await extraerTextoPdf(pdf);
    if (!texto.ok || !textoAntes.ok) throw new Error("text extraction failed");
    expect(texto.paginas.slice(0, 2)).toEqual(textoAntes.paginas.slice(0, 2));
    expect(texto.paginas[2]).toContain("Hoja 3 de 3 - recibo de prueba");
    expect(texto.paginas[2]).toContain(LINEA);
  });

  it("puts the line at the bottom right of an upright page", async () => {
    const p = await posicionLinea(await estampar(await recibo()));
    expect(p.finX).toBeCloseTo(p.ancho - MARGEN_DERECHO_PT, 0);
    expect(p.y).toBeCloseTo(p.alto - MARGEN_INFERIOR_PT, 0);
    expect(p.finY).toBeCloseTo(p.y, 3);
  });

  it.each([90, 180, 270])("handles a last page rotated %i degrees, with a crop box", async (giro) => {
    const pdf = await recibo({ giro, recorte: [20, 30, 500, 700] });
    const salida = await estampar(pdf);
    const p = await posicionLinea(salida);
    // Displayed size: the crop box, turned.
    expect([p.ancho, p.alto]).toEqual(giro === 180 ? [500, 700] : [700, 500]);
    // Upright on screen, at the bottom right of the displayed page.
    expect(p.finY).toBeCloseTo(p.y, 3);
    expect(p.finX).toBeGreaterThan(p.x);
    expect(p.finX).toBeCloseTo(p.ancho - MARGEN_DERECHO_PT, 0);
    expect(p.y).toBeCloseTo(p.alto - MARGEN_INFERIOR_PT, 0);
    const texto = await extraerTextoPdf(salida);
    expect(texto.ok && texto.paginas[2]).toContain(LINEA);
  });

  it("renders es-AR accents and ñ", async () => {
    const texto = await extraerTextoPdf(await estampar(await recibo(), "Begoña Ñandú Güemes Ávalos"));
    expect(texto.ok && texto.paginas[2]).toContain("por Begoña Ñandú Güemes Ávalos el");
  });

  it("replaces a character the font cannot render instead of throwing", async () => {
    const texto = await extraerTextoPdf(await estampar(await recibo(), "Zoë ✓ 李\nPrueba"));
    expect(texto.ok && texto.paginas[2]).toContain("por Zoë ? ? Prueba el");
  });

  it("stamps a one-page PDF", async () => {
    const salida = await estampar(await recibo({}, 1));
    const documento = await PDFDocument.load(salida);
    expect(documento.getPageCount()).toBe(1);
    expect(imagenes(documento.getPage(0))).toBe(1);
  });

  it("refuses an encrypted PDF with a typed error", async () => {
    for (const userPassword of ["clave-de-prueba", ""]) {
      const documento = await PDFDocument.create();
      documento.addPage();
      documento.encrypt({ userPassword, ownerPassword: "otra-clave-de-prueba" });
      const intento = estampar(await documento.save());
      await expect(intento).rejects.toBeInstanceOf(EstampaError);
      await expect(intento).rejects.toMatchObject({ motivo: "cifrado" });
    }
  });

  it("refuses bytes that are not a PDF, and an invalid signature image", async () => {
    await expect(estampar(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({ motivo: "ilegible" });
    const intento = estamparFirma(await recibo(), new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { nombre: NOMBRE, firmadoEn: FIRMADO_EN });
    await expect(intento).rejects.toMatchObject({ motivo: "firma_invalida" });
  });
});

describe("medidaFirma", () => {
  it("fits the 160 x 60 pt box, keeping the aspect ratio", () => {
    expect(medidaFirma(400, 100)).toEqual({ ancho: 160, alto: 40 });
    expect(medidaFirma(100, 200)).toEqual({ ancho: 30, alto: 60 });
    expect(medidaFirma(320, 120)).toEqual({ ancho: 160, alto: 60 });
  });
});

describe("fechaHoraArgentina", () => {
  it("formats dd/mm/aaaa and HH:mm in Buenos Aires time", () => {
    expect(fechaHoraArgentina(FIRMADO_EN)).toEqual({ fecha: "28/02/2026", hora: "23:30" });
    expect(fechaHoraArgentina(new Date("2026-07-09T15:05:00Z"))).toEqual({ fecha: "09/07/2026", hora: "12:05" });
    expect(fechaHoraArgentina(new Date("2026-01-01T03:00:00Z"))).toEqual({ fecha: "01/01/2026", hora: "00:00" });
  });
});

describe("textoRepresentable", () => {
  it("keeps WinAnsi characters and replaces the rest", async () => {
    const documento = await PDFDocument.create();
    const font = await documento.embedFont(StandardFonts.Helvetica);
    expect(textoRepresentable("áéíóú ÁÉÍÓÚ ñÑ üÜ ¿¡", font)).toBe("áéíóú ÁÉÍÓÚ ñÑ üÜ ¿¡");
    expect(textoRepresentable("a\tb\r\nc  ✓ 😀", font)).toBe("a b c ? ?");
    // Decomposed accents are composed first.
    expect(textoRepresentable("Peña", font)).toBe("Peña");
  });
});
