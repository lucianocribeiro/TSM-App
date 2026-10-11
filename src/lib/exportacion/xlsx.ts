import "server-only";
import writeExcelFile from "write-excel-file/node";
import type { Hoja } from "./planilla";

// Writes the workbook to an in-memory .xlsx (CR-4). Server only: the library
// never reaches a client bundle, and nothing is written to disk.
export async function escribirXlsx(hojas: readonly Hoja[]): Promise<Buffer> {
  return writeExcelFile(hojas.map((hoja) => ({ ...hoja }))).toBuffer();
}
