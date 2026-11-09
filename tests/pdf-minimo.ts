// A minimal one-page PDF with the given lines of text (standard Helvetica,
// ASCII only), written by hand: integration and e2e fixtures stay away from
// the PDF libraries, which only the receipt wrappers may import (F2-07).
// Invented content only. Correct xref offsets, so any reader opens it.
export function pdfConTexto(lineas: readonly string[]): Buffer {
  const escapar = (texto: string) => texto.replace(/[\\()]/g, (c) => `\\${c}`);
  const flujo = ["BT", "/F1 12 Tf", "50 780 Td", ...lineas.flatMap((linea, i) => [...(i > 0 ? ["0 -18 Td"] : []), `(${escapar(linea)}) Tj`]), "ET"].join("\n");
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(flujo, "latin1")} >>\nstream\n${flujo}\nendstream`,
  ];
  let cuerpo = "%PDF-1.4\n";
  const offsets: number[] = [];
  objetos.forEach((objeto, i) => {
    offsets.push(Buffer.byteLength(cuerpo, "latin1"));
    cuerpo += `${i + 1} 0 obj\n${objeto}\nendobj\n`;
  });
  const xref = Buffer.byteLength(cuerpo, "latin1");
  cuerpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) cuerpo += `${String(offset).padStart(10, "0")} 00000 n \n`;
  cuerpo += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(cuerpo, "latin1");
}
