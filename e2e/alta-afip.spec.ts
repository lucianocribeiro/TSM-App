import { readFileSync } from "node:fs";
import { expect, test, type Locator } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { formatCopy } from "../src/lib/copy/format";
import { adminNuevo, altaAfipCargada, empleadoCompleto, pdf, registro } from "./datos";
import { loginAs } from "./helpers";
import { localServiceClient } from "./service";

// CR-3: the Alta de AFIP. The Admin uploads it in /legajos/[id]; the
// employee sees it in Mi Legajo and downloads it, with no control to upload,
// replace or delete it; with none uploaded, the employee sees that Recursos
// Humanos loads it. The Admin's own Mi Legajo follows the same rules. (The
// Admin's full cycle for the type is in legajos-documentos.spec.ts.)

const t = copy.miLegajo.documentos;
const documento = copy.documentos.tipos.alta_afip;
const cuentas = registro();
test.afterAll(cuentas.limpiar);

function baseURL(): string {
  const url = test.info().project.use.baseURL;
  if (!url) throw new Error("baseURL is required");
  return url;
}

// The row has the download only: no file input, no upload, replace or delete.
async function soloDescarga(fila: Locator, conArchivo: boolean) {
  await expect(fila.locator('input[type="file"]')).toHaveCount(0);
  for (const nombre of [t.subir, t.subirNuevo, t.eliminar, copy.legajos.documentos.reemplazar]) {
    await expect(fila.getByRole("button", { name: nombre, exact: true })).toHaveCount(0);
  }
  await expect(fila.getByRole("button", { name: t.descargar, exact: true })).toHaveCount(conArchivo ? 1 : 0);
}

test("the Admin uploads it; the employee sees it in Mi Legajo and downloads it, with no control to change it", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const emp = await empleadoCompleto("alta-afip", cuentas.add);
  await loginAs(page, await adminNuevo("alta-afip-admin", cuentas.add));
  await page.goto(`/legajos/${emp.id}`);
  const filaAdmin = page.getByTestId("documento-alta_afip");
  await expect(filaAdmin).toContainText(t.opcional);
  await expect(filaAdmin).toContainText(t.estados.faltante);
  // Hydrated before the upload (see legajos-documentos.spec.ts).
  const grupoA = page.getByTestId("grupo-A");
  await grupoA.getByRole("button", { name: copy.miLegajo.editar }).click();
  await grupoA.getByRole("button", { name: copy.miLegajo.cancelar }).click();
  await page.getByLabel(formatCopy(t.archivoLabel, { documento }), { exact: true }).setInputFiles(pdf("alta-afip-e2e"));
  await expect(page.getByRole("status").filter({ hasText: t.exito.subidoAdmin })).toBeVisible();
  await expect(filaAdmin).toContainText(t.estados.aprobado);
  const { data: filas } = await localServiceClient()
    .from("legajo_documentos")
    .select("estado")
    .eq("legajo_id", emp.legajoId)
    .eq("tipo", "alta_afip");
  expect(filas).toEqual([{ estado: "aprobado" }]);

  const context = await browser.newContext({ baseURL: baseURL() });
  const empleado = await context.newPage();
  await loginAs(empleado, emp);
  const fila = empleado.getByTestId("documento-alta_afip");
  await expect(fila).toContainText(documento);
  await expect(fila).toContainText(t.soloAdmin.aprobado);
  await soloDescarga(fila, true);
  // The other types keep their upload.
  await expect(empleado.getByTestId("documento-dni_frente").locator('input[type="file"]')).toHaveCount(1);

  const descarga = empleado.waitForEvent("download");
  await fila.getByRole("button", { name: t.descargar, exact: true }).click();
  const archivo = await descarga;
  expect(archivo.suggestedFilename()).toBe("alta-afip-e2e.pdf");
  expect(archivo.url()).toContain("/storage/v1/object/sign/legajo-docs/");
  expect(readFileSync(await archivo.path(), "utf8")).toContain("FAKE TEST FILE - alta-afip-e2e");
  await expect(empleado).toHaveURL(/\/mi-legajo$/);
  await context.close();
});

test("with none uploaded, the employee sees that Recursos Humanos loads it, and no action", async ({ page }) => {
  const emp = await empleadoCompleto("alta-afip-faltante", cuentas.add);
  await loginAs(page, emp);
  const fila = page.getByTestId("documento-alta_afip");
  await expect(fila).toContainText(documento);
  await expect(fila).toContainText(t.soloAdmin.faltante);
  await expect(fila).toContainText(t.opcional);
  await soloDescarga(fila, false);
});

test("the Admin's own Mi Legajo has the download only too", async ({ page }) => {
  const admin = await adminNuevo("alta-afip-propia", cuentas.add);
  const { data } = await localServiceClient().from("legajos").select("id").eq("profile_id", admin.id).single();
  await altaAfipCargada({ id: admin.id, legajoId: data!.id }, admin.id, "alta-afip-propia");
  await loginAs(page, admin);
  const fila = page.getByTestId("documento-alta_afip");
  await expect(fila).toContainText(t.soloAdmin.aprobado);
  await soloDescarga(fila, true);
});
