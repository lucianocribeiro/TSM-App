import "server-only";
import { degrees, EncryptedPDFError, PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { formatCopy } from "@/lib/copy/format";
import { copyRecibosServidor } from "@/lib/copy/recibos-servidor";

// Signature stamp of a receipt (PRD Fase 2 RF-17, F2-07): the employee's
// PNG signature and one line with their name, date and time, at the bottom
// right of the last page as it is displayed (rotation and crop box
// respected). Only the last page gets new content; nothing is written to
// disk.

export const FIRMA_ANCHO_MAX_PT = 160;
export const FIRMA_ALTO_MAX_PT = 60;
export const MARGEN_INFERIOR_PT = 24;
export const MARGEN_DERECHO_PT = 36;
const TAMANO_TEXTO_PT = 8;
const TAMANO_TEXTO_MIN_PT = 5;
const SEPARACION_PT = 4;
const ZONA_HORARIA = "America/Argentina/Buenos_Aires";
const REEMPLAZO = "?";

export type MotivoEstampa = "cifrado" | "ilegible" | "firma_invalida";

// Typed refusal: the caller maps the reason to its own message.
export class EstampaError extends Error {
  readonly motivo: MotivoEstampa;
  constructor(motivo: MotivoEstampa) {
    super(`signature stamp refused: ${motivo}`);
    this.name = "EstampaError";
    this.motivo = motivo;
  }
}

export type DatosEstampa = { nombre: string; firmadoEn: Date };

// dd/mm/aaaa and HH:mm in Argentina time.
export function fechaHoraArgentina(instante: Date): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat("es-AR", {
    timeZone: ZONA_HORARIA,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? "";
  return {
    fecha: `${parte("day")}/${parte("month")}/${parte("year")}`,
    hora: `${parte("hour")}:${parte("minute")}`,
  };
}

// The standard font covers WinAnsi (es-AR accents and ñ included). Any other
// character becomes "?", and line breaks and control characters a space, so
// a name never makes the stamp fail.
export function textoRepresentable(texto: string, font: PDFFont): string {
  const admitidos = new Set(font.getCharacterSet());
  return Array.from(texto.normalize("NFC"), (caracter) => {
    if (/\p{Cc}|\s/u.test(caracter)) return " ";
    return admitidos.has(caracter.codePointAt(0)!) ? caracter : REEMPLAZO;
  })
    .join("")
    .replace(/ {2,}/g, " ")
    .trim();
}

// The signature scaled to fit the 160 x 60 pt box, aspect ratio kept.
export function medidaFirma(anchoPx: number, altoPx: number): { ancho: number; alto: number } {
  const escala = Math.min(FIRMA_ANCHO_MAX_PT / anchoPx, FIRMA_ALTO_MAX_PT / altoPx);
  return { ancho: anchoPx * escala, alto: altoPx * escala };
}

export async function estamparFirma(pdf: Uint8Array, firmaPng: Uint8Array, datos: DatosEstampa): Promise<Uint8Array> {
  let documento: PDFDocument;
  try {
    documento = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch (error) {
    throw new EstampaError(error instanceof EncryptedPDFError ? "cifrado" : "ilegible");
  }
  if (documento.isEncrypted) throw new EstampaError("cifrado");
  const paginas = documento.getPages();
  const ultima = paginas.at(-1);
  if (!ultima) throw new EstampaError("ilegible");

  let imagen;
  try {
    imagen = await documento.embedPng(firmaPng);
  } catch {
    throw new EstampaError("firma_invalida");
  }
  const font = await documento.embedFont(StandardFonts.Helvetica);

  const { fecha, hora } = fechaHoraArgentina(datos.firmadoEn);
  const nombre = textoRepresentable(datos.nombre, font);
  const linea = textoRepresentable(formatCopy(copyRecibosServidor.estampaFirma, { nombre, fecha, hora }), font);

  const vista = vistaDePagina(ultima);
  const anchoUtil = vista.ancho - 2 * MARGEN_DERECHO_PT;
  // A long name shrinks the line down to a minimum size, never past it.
  const tamano = Math.max(
    TAMANO_TEXTO_MIN_PT,
    Math.min(TAMANO_TEXTO_PT, (anchoUtil / font.widthOfTextAtSize(linea, TAMANO_TEXTO_PT)) * TAMANO_TEXTO_PT),
  );
  const anchoTexto = font.widthOfTextAtSize(linea, tamano);

  const { ancho: anchoFirma, alto: altoFirma } = medidaFirma(imagen.width, imagen.height);

  // Bottom right of the page as displayed: the line, and the signature above it.
  const texto = vista.aPagina(vista.ancho - MARGEN_DERECHO_PT - anchoTexto, MARGEN_INFERIOR_PT);
  const firma = vista.aPagina(
    vista.ancho - MARGEN_DERECHO_PT - anchoFirma,
    MARGEN_INFERIOR_PT + tamano + SEPARACION_PT,
  );
  ultima.drawImage(imagen, { ...firma, width: anchoFirma, height: altoFirma, rotate: degrees(vista.giro) });
  ultima.drawText(linea, { ...texto, size: tamano, font, rotate: degrees(vista.giro) });

  return documento.save();
}

// The page as displayed: its visible width and height (crop box, rotated),
// and the map from a displayed point (origin bottom left) to page space,
// with the angle that keeps drawn content upright on screen.
function vistaDePagina(pagina: PDFPage) {
  const caja = pagina.getCropBox();
  const giro = (((pagina.getRotation().angle % 360) + 360) % 360) as number;
  const girada = giro === 90 || giro === 270;
  const ancho = girada ? caja.height : caja.width;
  const alto = girada ? caja.width : caja.height;
  function aPagina(vx: number, vy: number): { x: number; y: number } {
    switch (giro) {
      case 90:
        return { x: caja.x + caja.width - vy, y: caja.y + vx };
      case 180:
        return { x: caja.x + caja.width - vx, y: caja.y + caja.height - vy };
      case 270:
        return { x: caja.x + vy, y: caja.y + caja.height - vx };
      default:
        return { x: caja.x + vx, y: caja.y + vy };
    }
  }
  // Rotations other than multiples of 90 are not valid PDF: treated as 0.
  return { ancho, alto, giro: [90, 180, 270].includes(giro) ? giro : 0, aPagina };
}
