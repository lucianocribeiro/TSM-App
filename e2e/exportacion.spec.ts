import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { copyLaborales } from "../src/lib/copy/laborales";
import { formatCopy } from "../src/lib/copy/format";
import { adminNuevo, empleadoCompleto, registro } from "./datos";
import { loginAs } from "./helpers";
import { createE2EUser, fillLaboral, localServiceClient } from "./service";
import { fechaDeSerial, leerXlsx } from "./xlsx";

// CR-4: the Excel export from /legajos and its history, and the Admin's own
// group E, read only, in Mi Legajo. The downloaded file is parsed here and
// deleted right after (Playwright also deletes downloads with their
// context); it never lands in an uploaded artifact folder.

const t = copy.exportacion;
const cuentas = registro();
test.afterAll(cuentas.limpiar);

test("the Admin exports the filtered list with chosen fields and the children; the history shows it", async ({ page }) => {
  test.setTimeout(90_000);
  const marca = `Excel${randomUUID().slice(0, 8)}`;
  const service = localServiceClient();
  const empleados = [];
  for (const nombre of ["Ana", "Beto"]) {
    const emp = await empleadoCompleto(`exporta-${nombre}`, cuentas.add, { tieneHijos: nombre === "Ana" });
    expect((await service.from("legajos").update({ apellido: marca, nombres: nombre }).eq("id", emp.legajoId)).error).toBeNull();
    empleados.push(emp);
  }
  expect(
    (await service.from("legajo_hijos").insert({ legajo_id: empleados[0].legajoId, nombre_completo: "Hija Prueba", fecha_nacimiento: "2016-02-03" }))
      .error,
  ).toBeNull();

  const admin = await adminNuevo("exporta-admin", cuentas.add);
  await loginAs(page, admin);
  await page.goto("/legajos");
  await page.getByLabel(copy.legajos.busqueda.label, { exact: true }).fill(marca);
  await expect(page.getByTestId("legajo-row")).toHaveCount(2);

  await page.getByRole("button", { name: t.boton }).click();
  const dialogo = page.getByRole("dialog", { name: t.dialogo.title });
  await expect(dialogo.getByTestId("exportar-cantidad")).toHaveText(formatCopy(t.dialogo.cantidad, { n: "2" }));
  // At least one field.
  await dialogo.getByRole("button", { name: t.dialogo.exportar }).click();
  await expect(dialogo.getByRole("alert")).toHaveText(t.dialogo.requerido);

  await dialogo.getByRole("button", { name: `${copy.miLegajo.grupos.A}: ${t.dialogo.grupoTodo}` }).click();
  await dialogo.getByRole("button", { name: `${copyLaborales.grupo}: ${t.dialogo.grupoTodo}` }).click();
  await dialogo.getByLabel(t.dialogo.hijos, { exact: true }).check();
  const descarga = page.waitForEvent("download");
  await dialogo.getByRole("button", { name: t.dialogo.exportar }).click();
  const archivo = await descarga;
  await expect(page.getByRole("status").filter({ hasText: t.exito })).toBeVisible();

  expect(archivo.suggestedFilename()).toMatch(/^legajos-\d{4}-\d{2}-\d{2}-\d{4}\.xlsx$/);
  const libro = leerXlsx(readFileSync(await archivo.path()));
  await archivo.delete();

  expect(libro.hojas.map((h) => h.nombre)).toEqual([t.hojas.legajos, t.hojas.hijos]);
  const [encabezado, ...filas] = libro.hojas[0].filas;
  const columnas = encabezado.map((c) => c.texto);
  expect(columnas.slice(0, 3)).toEqual([copy.aprobaciones.campos.nombres, copy.aprobaciones.campos.apellido, copy.aprobaciones.campos.dni]);
  expect(columnas).toContain(copyLaborales.campos.area);
  expect(filas).toHaveLength(2);
  expect(filas.map((f) => f[0].texto)).toEqual(["Ana", "Beto"]);
  // A list field by name, and a date cell.
  expect(filas[0][columnas.indexOf(copyLaborales.campos.area)].texto).toBe("Ventas");
  const nacimiento = filas[0][columnas.indexOf(copy.aprobaciones.campos.fecha_nacimiento)];
  expect(nacimiento.texto).toBeNull();
  expect(fechaDeSerial(nacimiento.numero!)).toBe("1990-01-01");
  expect(libro.estilos[nacimiento.estilo!].formato).toBe("dd/mm/yyyy");
  // Hijos: one row per child, linked to the employee.
  expect(libro.hojas[1].filas.slice(1).map((f) => [f[1].texto, f[2].texto, f[3].texto, fechaDeSerial(f[4].numero!)])).toEqual([
    [marca, "Ana", "Hija Prueba", "2016-02-03"],
  ]);

  // The history shows it: who, how many, which data, the children, the filters.
  await page.getByRole("link", { name: t.historialLink }).click();
  await expect(page).toHaveURL(/\/legajos\/exportaciones$/);
  const fila = page.getByTestId("exportacion-row").filter({ hasText: admin.email });
  await expect(fila).toHaveCount(1);
  await expect(fila).toContainText(formatCopy(t.historial.grupoCompleto, { grupo: copy.miLegajo.grupos.A }));
  await expect(fila).toContainText(formatCopy(t.historial.busqueda, { texto: marca }));
  await expect(fila.locator("td").nth(2)).toHaveText("2");
  await expect(fila.locator("td").nth(4)).toHaveText(t.historial.si);
});

test("an Empleado has no export and cannot reach the history", async ({ page }) => {
  const empleado = await createE2EUser(`exporta-empleado-${randomUUID().slice(0, 8)}`);
  cuentas.add(empleado.id);
  await loginAs(page, empleado);
  await expect(page.getByRole("button", { name: t.boton })).toHaveCount(0);
  for (const path of ["/legajos", "/legajos/exportaciones"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/mi-legajo$/);
  }
  await expect(page.getByRole("button", { name: t.boton })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: t.historial.title })).toHaveCount(0);
});

test("the Admin's own Mi Legajo shows their group E read only, with a link to edit it in Legajos", async ({ page }) => {
  const admin = await adminNuevo("exporta-propio", cuentas.add);
  const numero = `P-${randomUUID().slice(0, 8)}`;
  await fillLaboral(admin.id, { numero_legajo: numero });
  await loginAs(page, admin);
  const panel = page.getByTestId("grupo-E-propio");
  await expect(panel.getByRole("heading", { name: copyLaborales.grupo })).toBeVisible();
  await expect(panel).toContainText(copyLaborales.campos.numero_legajo);
  await expect(panel).toContainText(numero);
  await expect(panel).toContainText(copyLaborales.propio.nota);
  // Read only: no field to edit here.
  await expect(panel.getByRole("button", { name: copy.miLegajo.editar })).toHaveCount(0);
  await expect(panel.locator("input, select, textarea")).toHaveCount(0);
  await panel.getByRole("link", { name: copyLaborales.propio.editar }).click();
  await expect(page).toHaveURL(new RegExp(`/legajos/${admin.id}$`));
  await expect(page.getByTestId("grupo-E")).toBeVisible();
});
