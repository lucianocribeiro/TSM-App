// Bundle regression check for AUDCR2-01: Mi Legajo's client chunks must not
// carry group E (Datos laborales) labels or field identifiers. Group E is
// Admin only; its copy and module (src/lib/copy/laborales.ts,
// src/lib/legajo/laborales.ts) are imported by the Admin routes only.
//
// Runs after `npm run build` (CI build job; locally: npm run check:bundle).
// Reads the route's client reference manifest to find every JavaScript chunk
// the browser loads for /mi-legajo (layouts included), and fails if any of
// them contains a forbidden string, raw or \u-escaped. As a control, the same
// scan must find group E in the Legajo detail route, so a scan that reads the
// wrong files (or nothing) cannot pass. Prints chunk names and strings only.
//
// CR-4 adds a second check: the .xlsx writer (write-excel-file) is server
// only. No client chunk of any route may contain its workbook paths, and,
// as a control, a server chunk must.
//
// F2-04 adds a third: the Carga de recibos copy (src/lib/copy/recibos.ts) is
// Admin only. Mi Legajo's client chunks must not carry it; as a control, the
// /recibos route's chunks must.
//
// F2-05 adds two more: the employee's Mis Recibos client chunks must not
// carry the Admin receipts copy either; and the PDF libraries (unpdf,
// @cantoo/pdf-lib) are server only: no client chunk of any route may contain
// their marker strings, and, as a control, a server chunk must.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Group E labels (src/lib/copy/laborales.ts) and field identifiers
// (CAMPOS_LABORALES and the table), kept in step by
// src/lib/legajo/bundle-mi-legajo.test.ts.
export const TEXTOS_PROHIBIDOS = ["Datos laborales", "Número de legajo", "Fecha de ingreso", "Estado laboral", "Antigüedad"];
export const IDS_PROHIBIDOS = [
  "numero_legajo",
  "area_id",
  "puesto_id",
  "fecha_ingreso",
  "estado_laboral",
  "sucursal_id",
  "tarea_id",
  "convenio_id",
  "categoria_id",
  "legajos_laborales",
];
export const PROHIBIDOS = [...TEXTOS_PROHIBIDOS, ...IDS_PROHIBIDOS];

// A string only the .xlsx writer carries: the worksheet part's path.
export const MARCA_XLSX = "xl/worksheets/";

// Carga de recibos texts (src/lib/copy/recibos.ts), kept in step by
// src/lib/legajo/bundle-mi-legajo.test.ts.
export const RECIBOS_PROHIBIDOS = ["Carga de recibos", "No encontramos el DNI", "Reemplazar recibo"];

// Strings only the PDF libraries carry: pdf-lib's encrypted-input error and
// pdf.js's structure error.
export const MARCAS_PDF = ["Input document to `PDFDocument.load` is encrypted", "Invalid PDF structure"];

const RUTA = "/(app)/mi-legajo/page";
const CONTROL = "/(app)/legajos/[id]/page";
const CONTROL_RECIBOS = "/(app)/recibos/page";
const MIS_RECIBOS = "/(app)/mis-recibos/page";

// The text and its \u-escaped form (a minifier may escape non-ASCII).
function variantes(texto) {
  const escapado = texto.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return escapado === texto ? [texto] : [texto, escapado];
}

// Pure: which forbidden strings each chunk contains. chunks: [name, content].
export function buscarProhibidos(chunks, prohibidos = PROHIBIDOS) {
  const hallazgos = [];
  for (const [nombre, contenido] of chunks) {
    for (const texto of prohibidos) {
      if (variantes(texto).some((v) => contenido.includes(v))) hallazgos.push({ chunk: nombre, texto });
    }
  }
  return hallazgos;
}

// The JavaScript chunks of a route, from its client reference manifest.
export function chunksDeRuta(nextDir, ruta) {
  const manifest = path.join(nextDir, "server", "app", `${ruta}_client-reference-manifest.js`);
  if (!existsSync(manifest)) throw new Error(`No client manifest for ${ruta}: run npm run build first.`);
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(manifest, "utf8"), sandbox);
  const datos = sandbox.__RSC_MANIFEST?.[ruta];
  if (!datos) throw new Error(`The manifest has no entry for ${ruta}.`);

  const nombres = new Set();
  for (const modulo of Object.values(datos.clientModules ?? {})) {
    for (const chunk of modulo.chunks ?? []) nombres.add(chunk.replace(/^\/_next\//, ""));
  }
  for (const lista of Object.values(datos.entryJSFiles ?? {})) {
    for (const chunk of lista) nombres.add(chunk.replace(/^\/_next\//, ""));
  }
  const chunks = [...nombres].filter((nombre) => nombre.endsWith(".js"));
  if (chunks.length === 0) throw new Error(`No JavaScript chunks found for ${ruta}.`);
  return chunks.map((nombre) => [nombre, readFileSync(path.join(nextDir, nombre), "utf8")]);
}

// Every .js file under a directory, as [name, content].
function archivosJs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((nombre) => nombre.endsWith(".js"))
    .map((nombre) => [nombre, readFileSync(path.join(dir, nombre), "utf8")]);
}

function main() {
  const nextDir = path.join(process.cwd(), ".next");
  const miLegajo = chunksDeRuta(nextDir, RUTA);
  const hallazgos = buscarProhibidos(miLegajo);

  const control = buscarProhibidos(chunksDeRuta(nextDir, CONTROL), ["Datos laborales", "numero_legajo"]);
  const controlOk = new Set(control.map((h) => h.texto)).size === 2;

  console.log(`Mi Legajo client chunks scanned: ${miLegajo.length}; forbidden strings checked: ${PROHIBIDOS.length}.`);
  for (const { chunk, texto } of hallazgos) console.log(`  found "${texto}" in ${chunk}`);
  if (!controlOk) console.log("  control failed: group E not found in the Legajo detail chunks; the scan is not reading the bundle.");
  const clientes = archivosJs(path.join(nextDir, "static", "chunks"));
  const xlsxCliente = buscarProhibidos(clientes, [MARCA_XLSX]);
  const xlsxServidor = buscarProhibidos(archivosJs(path.join(nextDir, "server")), [MARCA_XLSX]).length > 0;
  console.log(`Client chunks scanned for the .xlsx writer: ${clientes.length}.`);
  for (const { chunk } of xlsxCliente) console.log(`  .xlsx writer found in client chunk ${chunk}`);
  if (!xlsxServidor) console.log("  control failed: the .xlsx writer was not found in any server chunk.");

  const recibosMiLegajo = buscarProhibidos(miLegajo, RECIBOS_PROHIBIDOS);
  const recibosControl = new Set(buscarProhibidos(chunksDeRuta(nextDir, CONTROL_RECIBOS), RECIBOS_PROHIBIDOS).map((h) => h.texto));
  const recibosControlOk = recibosControl.size === RECIBOS_PROHIBIDOS.length;
  for (const { chunk, texto } of recibosMiLegajo) console.log(`  found receipts Admin text "${texto}" in ${chunk}`);
  if (!recibosControlOk) console.log("  control failed: the Carga de recibos texts were not found in the /recibos chunks.");

  const misRecibos = chunksDeRuta(nextDir, MIS_RECIBOS);
  const recibosEnMisRecibos = buscarProhibidos(misRecibos, RECIBOS_PROHIBIDOS);
  for (const { chunk, texto } of recibosEnMisRecibos) console.log(`  found receipts Admin text "${texto}" in Mis Recibos chunk ${chunk}`);
  const pdfCliente = buscarProhibidos(clientes, MARCAS_PDF);
  const pdfServidor = new Set(buscarProhibidos(archivosJs(path.join(nextDir, "server")), MARCAS_PDF).map((h) => h.texto)).size === MARCAS_PDF.length;
  for (const { chunk, texto } of pdfCliente) console.log(`  PDF library marker "${texto}" found in client chunk ${chunk}`);
  if (!pdfServidor) console.log("  control failed: the PDF library markers were not found in the server chunks.");

  if (
    hallazgos.length > 0 ||
    !controlOk ||
    clientes.length === 0 ||
    xlsxCliente.length > 0 ||
    !xlsxServidor ||
    recibosMiLegajo.length > 0 ||
    !recibosControlOk ||
    misRecibos.length === 0 ||
    recibosEnMisRecibos.length > 0 ||
    pdfCliente.length > 0 ||
    !pdfServidor
  ) {
    console.log("Bundle check failed.");
    process.exit(1);
  }
  console.log("Bundle check passed: no group E strings in Mi Legajo's client chunks (control found them in Legajo detail).");
  console.log("Bundle check passed: the .xlsx writer is in no client chunk (control found it server side).");
  console.log("Bundle check passed: no Carga de recibos texts in Mi Legajo's client chunks (control found them in /recibos).");
  console.log("Bundle check passed: no Carga de recibos texts in Mis Recibos' client chunks.");
  console.log("Bundle check passed: the PDF libraries are in no client chunk (control found them server side).");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
