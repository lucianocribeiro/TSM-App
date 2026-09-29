import { readFileSync } from "node:fs";
import { expect, test, type Download, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { formatCopy } from "../src/lib/copy/format";
import type { Database } from "../src/lib/supabase/database.types";
import { adminNuevo, BUCKET, empleadoCompleto, pdf, registro } from "./datos";
import { loginAs } from "./helpers";
import { localServiceClient } from "./service";

// F1-11B, GAP-05 (documents): for each document type, the Admin's full cycle
// in /legajos/[id]: upload, replace keeping history, replace for good (after
// the confirmation), download, delete. The database and the stored objects
// are checked after every step. Each test creates its own accounts.

type DocumentoTipo = Database["public"]["Enums"]["documento_tipo"];
const TIPOS: DocumentoTipo[] = ["dni_frente", "dni_dorso", "licencia_conducir"];
const ml = copy.miLegajo;
const r = copy.legajos.documentos;
const cuentas = registro();
test.afterAll(cuentas.limpiar);

async function filasDe(legajoId: string, tipo: DocumentoTipo) {
  const { data } = await localServiceClient()
    .from("legajo_documentos")
    .select("estado, file_name, storage_path")
    .eq("legajo_id", legajoId)
    .eq("tipo", tipo)
    .order("created_at");
  return data ?? [];
}
const estados = async (legajoId: string, tipo: DocumentoTipo) =>
  (await filasDe(legajoId, tipo)).map((fila) => [fila.file_name, fila.estado]);
const existe = async (path: string) => (await localServiceClient().storage.from(BUCKET).download(path)).data !== null;

// A download is served as an attachment with the file's name, from a signed
// URL valid for 5 minutes.
async function comprobarDescarga(download: Download, nombre: string, contenido: string) {
  expect(download.suggestedFilename()).toBe(nombre);
  expect(readFileSync(await download.path(), "utf8")).toContain(contenido);
  const url = new URL(download.url());
  expect(url.pathname).toContain(`/object/sign/${BUCKET}/`);
  expect(url.searchParams.get("download")).toBe(nombre);
  const token = url.searchParams.get("token") ?? "";
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { iat: number; exp: number };
  expect(payload.exp - payload.iat).toBe(300);
}

async function descargar(page: Page, boton: ReturnType<Page["getByRole"]>) {
  const download = page.waitForEvent("download");
  await boton.click();
  return download;
}

for (const tipo of TIPOS) {
  const documento = copy.documentos.tipos[tipo];

  test(`${tipo}: upload, replace keeping history, replace for good, download and delete`, async ({ page }) => {
    // The whole cycle, with a database check after every step.
    test.setTimeout(90_000);
    const emp = await empleadoCompleto(`documentos-${tipo}`, cuentas.add);
    await loginAs(page, await adminNuevo(`documentos-${tipo}-admin`, cuentas.add));
    await page.goto(`/legajos/${emp.id}`);
    const fila = page.getByTestId(`documento-${tipo}`);
    const historial = page.getByTestId(`historial-${tipo}`);
    await expect(fila).toContainText(ml.documentos.estados.faltante);
    // The page is hydrated before the first upload: a file set on the
    // server-rendered input earlier would never reach its change handler.
    const grupoA = page.getByTestId("grupo-A");
    await grupoA.getByRole("button", { name: ml.editar }).click();
    await grupoA.getByRole("button", { name: ml.cancelar }).click();
    await expect(grupoA.getByRole("button", { name: ml.editar })).toBeVisible();

    // Upload: approved at once.
    await page.getByLabel(formatCopy(ml.documentos.archivoLabel, { documento }), { exact: true }).setInputFiles(pdf(`v1-${tipo}`));
    await expect(page.getByRole("status").filter({ hasText: ml.documentos.exito.subidoAdmin })).toBeVisible();
    await expect(fila).toContainText(ml.documentos.estados.aprobado);
    await expect.poll(() => estados(emp.legajoId, tipo)).toEqual([[`v1-${tipo}.pdf`, "aprobado"]]);

    // Replace keeping history: one approved, one replaced; the history
    // version is listed and downloads.
    const dialog = page.getByRole("dialog", { name: formatCopy(r.reemplazarTitle, { documento }) });
    await fila.getByRole("button", { name: r.reemplazar }).click();
    await expect(dialog.getByRole("radio", { name: new RegExp(r.conservar.label) })).toBeChecked();
    let chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: r.elegirArchivo }).click();
    await (await chooser).setFiles(pdf(`v2-${tipo}`));
    await expect.poll(() => estados(emp.legajoId, tipo)).toEqual([
      [`v1-${tipo}.pdf`, "reemplazado"],
      [`v2-${tipo}.pdf`, "aprobado"],
    ]);
    await expect(historial.getByTestId("historial-version")).toHaveCount(1);
    await expect(historial).toContainText(`v1-${tipo}.pdf`);
    await comprobarDescarga(
      await descargar(page, historial.getByRole("button", { name: ml.documentos.descargar })),
      `v1-${tipo}.pdf`,
      `FAKE TEST FILE - v1-${tipo}`,
    );
    const v2 = (await filasDe(emp.legajoId, tipo)).find((f) => f.estado === "aprobado")!.storage_path;

    // Replace for good: only after the confirmation; the previous row and
    // object are gone, the history is untouched.
    await fila.getByRole("button", { name: r.reemplazar }).click();
    await dialog.getByRole("radio", { name: new RegExp(r.definitivo.label) }).check();
    await expect(dialog.getByRole("button", { name: r.elegirArchivo })).toHaveCount(0);
    await dialog.getByRole("button", { name: r.definitivo.label }).click();
    const confirmacion = page.getByRole("dialog", { name: r.confirmarTitle });
    await expect(confirmacion.getByTestId("reemplazo-confirmacion")).toContainText(`v2-${tipo}.pdf`);
    chooser = page.waitForEvent("filechooser");
    await confirmacion.getByRole("button", { name: r.confirmar }).click();
    await (await chooser).setFiles(pdf(`v3-${tipo}`));
    await expect.poll(() => estados(emp.legajoId, tipo)).toEqual([
      [`v1-${tipo}.pdf`, "reemplazado"],
      [`v3-${tipo}.pdf`, "aprobado"],
    ]);
    await expect.poll(() => existe(v2)).toBe(false);
    await expect(historial.getByTestId("historial-version")).toHaveCount(1);

    // Download the current document, once the row shows it.
    await expect(fila.getByRole("button", { name: ml.documentos.descargar })).toBeEnabled();
    await expect(fila.getByRole("button", { name: r.reemplazar })).toBeEnabled();
    await comprobarDescarga(
      await descargar(page, fila.getByRole("button", { name: ml.documentos.descargar })),
      `v3-${tipo}.pdf`,
      `FAKE TEST FILE - v3-${tipo}`,
    );
    await expect(page).toHaveURL(new RegExp(`/legajos/${emp.id}$`));

    // Delete the current document: its row and object go; the history stays.
    const v3 = (await filasDe(emp.legajoId, tipo)).find((f) => f.estado === "aprobado")!.storage_path;
    await fila.getByRole("button", { name: ml.documentos.eliminar }).click();
    const eliminar = page.getByRole("dialog", { name: ml.documentos.eliminarTitle });
    await expect(eliminar).toContainText(r.eliminarVigenteBody);
    await eliminar.getByRole("button", { name: ml.documentos.eliminar }).click();
    await expect(fila).toContainText(ml.documentos.estados.faltante);
    await expect.poll(() => estados(emp.legajoId, tipo)).toEqual([[`v1-${tipo}.pdf`, "reemplazado"]]);
    await expect.poll(() => existe(v3)).toBe(false);
  });
}
