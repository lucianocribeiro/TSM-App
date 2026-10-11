import { inflateRawSync } from "node:zlib";

// A minimal .xlsx reader for tests (CR-4): unzips the workbook with Node's
// zlib and reads sheet names, cell values and the parts the export promises
// (date format, bold header, frozen first row). No dependency; enough for
// the files the export writes, not a general parser.

export type CeldaLeida = { texto: string | null; numero: number | null; estilo: number | null };
export type HojaLeida = { nombre: string; filas: CeldaLeida[][]; congelada: boolean };
export type LibroLeido = {
  hojas: HojaLeida[];
  // Cell style index → its number format code ("" when none) and bold.
  estilos: { formato: string; negrita: boolean }[];
};

// Files of a .zip, by name, from its central directory.
export function descomprimir(zip: Buffer): Map<string, Buffer> {
  let fin = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error("not a zip file");
  const entradas = zip.readUInt16LE(fin + 10);
  let pos = zip.readUInt32LE(fin + 16);
  const archivos = new Map<string, Buffer>();
  for (let n = 0; n < entradas; n++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) throw new Error("bad central directory");
    const metodo = zip.readUInt16LE(pos + 10);
    const comprimido = zip.readUInt32LE(pos + 20);
    const largoNombre = zip.readUInt16LE(pos + 28);
    const largoExtra = zip.readUInt16LE(pos + 30);
    const largoComentario = zip.readUInt16LE(pos + 32);
    const local = zip.readUInt32LE(pos + 42);
    const nombre = zip.subarray(pos + 46, pos + 46 + largoNombre).toString("utf8");
    const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const datos = zip.subarray(inicio, inicio + comprimido);
    archivos.set(nombre, metodo === 8 ? inflateRawSync(datos) : Buffer.from(datos));
    pos += 46 + largoNombre + largoExtra + largoComentario;
  }
  return archivos;
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function texto(xml: string): string {
  return xml.replace(/&(#x?[0-9a-f]+|\w+);/gi, (entidad, cuerpo: string) => {
    if (cuerpo.startsWith("#x") || cuerpo.startsWith("#X")) return String.fromCodePoint(parseInt(cuerpo.slice(2), 16));
    if (cuerpo.startsWith("#")) return String.fromCodePoint(Number(cuerpo.slice(1)));
    return ENTIDADES[cuerpo] ?? entidad;
  });
}

// The text of an <si> or <is>: its <t> runs, joined.
function textoDe(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => texto(m[1])).join("");
}

function columna(ref: string): number {
  const letras = /^[A-Z]+/.exec(ref)![0];
  return [...letras].reduce((n, letra) => n * 26 + letra.charCodeAt(0) - 64, 0) - 1;
}

export function leerXlsx(archivo: Buffer): LibroLeido {
  const partes = descomprimir(archivo);
  const leer = (nombre: string) => partes.get(nombre)?.toString("utf8") ?? "";

  const compartidos = [...leer("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1]));

  const estilosXml = leer("xl/styles.xml");
  const formatos = new Map([...estilosXml.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g)].map((m) => [m[1], texto(m[2])]));
  const fuentes = [...(/<fonts[^>]*>([\s\S]*?)<\/fonts>/.exec(estilosXml)?.[1] ?? "").matchAll(/<font>([\s\S]*?)<\/font>|<font\/>/g)].map(
    (m) => /<b\/>/.test(m[1] ?? ""),
  );
  const estilos = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(estilosXml)?.[1] ?? "").matchAll(/<xf([^>]*)>/g)].map((m) => {
    const atributos = m[1];
    const numFmt = /numFmtId="(\d+)"/.exec(atributos)?.[1];
    const fontId = Number(/fontId="(\d+)"/.exec(atributos)?.[1] ?? 0);
    return { formato: numFmt ? (formatos.get(numFmt) ?? "") : "", negrita: fuentes[fontId] ?? false };
  });

  const relaciones = new Map(
    [...leer("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\s+([^>]*?)\/>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[1])![1],
      /Target="([^"]+)"/.exec(m[1])![1],
    ]),
  );
  const hojas = [...leer("xl/workbook.xml").matchAll(/<sheet\s+([^>]*?)\/>/g)].map((m) => {
    const nombre = texto(/name="([^"]*)"/.exec(m[1])![1]);
    const destino = relaciones.get(/r:id="([^"]+)"/.exec(m[1])![1])!;
    const xml = leer(`xl/${destino.replace(/^\/?xl\//, "")}`);
    const filas: CeldaLeida[][] = [];
    for (const fila of xml.matchAll(/<row\s+r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const celdas: CeldaLeida[] = [];
      for (const celda of (fila[2] ?? "").matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const atributos = celda[1];
        const i = columna(/r="([A-Z]+)\d+"/.exec(atributos)![1]);
        const tipo = /t="(\w+)"/.exec(atributos)?.[1];
        const estilo = /s="(\d+)"/.exec(atributos)?.[1];
        const valor = /<v>([\s\S]*?)<\/v>/.exec(celda[2] ?? "")?.[1];
        const leida: CeldaLeida = { texto: null, numero: null, estilo: estilo === undefined ? null : Number(estilo) };
        if (tipo === "s" && valor !== undefined) leida.texto = compartidos[Number(valor)];
        else if (tipo === "inlineStr") leida.texto = textoDe(celda[2] ?? "");
        else if (tipo === "str" && valor !== undefined) leida.texto = texto(valor);
        else if (valor !== undefined) leida.numero = Number(valor);
        celdas[i] = leida;
      }
      filas[Number(fila[1]) - 1] = Array.from(celdas, (c) => c ?? { texto: null, numero: null, estilo: null });
    }
    const congelada = /<pane\b[^>]*ySplit="1"[^>]*state="frozen"/.test(xml);
    return { nombre, filas: Array.from(filas, (f) => f ?? []), congelada };
  });
  return { hojas, estilos };
}

// An Excel date serial (1900 system) as YYYY-MM-DD.
export function fechaDeSerial(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
}
