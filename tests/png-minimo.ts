import { crc32, deflateSync } from "node:zlib";

// A valid RGBA PNG of the given size, written by hand (a dark band on white
// paper, like a drawn signature): integration and e2e fixtures, invented
// content only.
export function pngFirma(ancho = 600, alto = 180): Buffer {
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
  const filas: Buffer[] = [];
  for (let y = 0; y < alto; y++) {
    const fila = Buffer.alloc(1 + ancho * 4, 255);
    fila[0] = 0;
    if (Math.abs(y - alto / 2) < 4) for (let x = ancho * 0.1; x < ancho * 0.9; x++) fila.set([0, 7, 46, 255], 1 + Math.floor(x) * 4);
    filas.push(fila);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", cabecera),
    trozo("IDAT", deflateSync(Buffer.concat(filas))),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}
