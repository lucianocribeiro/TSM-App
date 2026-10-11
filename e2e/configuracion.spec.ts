import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { formatCopy } from "../src/lib/copy/format";
import { adminNuevo, registro } from "./datos";
import { expectNavLinks, loginAs, SCREENSHOT_DIR } from "./helpers";
import { screenshotBoth } from "./screens";
import { createE2EUser, localServiceClient } from "./service";

// CR-1, Configuración (PRD "Configuración"): an Admin maintains the lists
// and reads their history; an Empleado cannot reach the section. Items
// created here carry a unique prefix and live at the end of Sucursal, so the
// seeded order is never touched; they and their history are removed after.

const t = copy.configuracion;
const cuentas = registro();
const actores: string[] = [];
const MARCA = `E2E ${randomUUID().slice(0, 8)}`;

test.afterAll(async () => {
  const service = localServiceClient();
  // The history names its Admin: it goes first, so the account can be removed.
  if (actores.length) await service.from("catalogo_eventos").delete().in("actor_id", actores);
  await service.from("catalogo_items").delete().like("nombre", `${MARCA}%`);
  await cuentas.limpiar();
});

function fila(page: Page, nombre: string) {
  return page.getByTestId("catalogo-item").filter({ has: page.getByText(nombre, { exact: true }) });
}

async function nombresEnOrden(page: Page) {
  return (await page.getByTestId("catalogo-item").allInnerTexts()).map((texto) => texto.split("\n")[0].trim());
}

async function agregar(page: Page, nombre: string) {
  await page.getByLabel(t.agregar.label, { exact: true }).fill(nombre);
  await page.getByRole("button", { name: t.agregar.submit, exact: true }).click();
}

test("an Admin adds, renames, reorders, deactivates, reactivates and deletes an item, and sees the history", async ({ page }) => {
  const admin = await adminNuevo("configuracion", cuentas.add);
  actores.push(admin.id);
  const uno = `${MARCA} Uno`;
  const dos = `${MARCA} Dos`;
  const tres = `${MARCA} Tres`;

  await loginAs(page, admin);
  await page.getByRole("navigation", { name: copy.nav.label }).getByRole("link", { name: copy.nav.configuracion }).click();
  await expect(page).toHaveURL(/\/configuracion$/);
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();

  // An Área with Puestos is in use: it cannot be deleted, only deactivated.
  const ventas = fila(page, "Ventas");
  await expect(ventas.getByRole("button", { name: t.acciones.desactivar })).toBeVisible();
  await expect(ventas.getByRole("button", { name: t.acciones.eliminar })).toHaveCount(0);

  await page.getByLabel(t.selectorLabel, { exact: true }).selectOption("sucursal");
  await expect(page).toHaveURL(/\?lista=sucursal$/);
  await expect(page.getByRole("heading", { level: 2, name: t.titulos.sucursal })).toBeVisible();

  // Add: at the end, trimmed.
  await agregar(page, `  ${uno} `);
  await expect(page.getByRole("status").filter({ hasText: formatCopy(t.exito.agregado, { nombre: uno }) })).toBeVisible();
  await expect(fila(page, uno)).toBeVisible();
  await agregar(page, dos);
  await expect(fila(page, dos)).toBeVisible();
  expect((await nombresEnOrden(page)).slice(-2)).toEqual([uno, dos]);

  // Duplicate name (case and spaces) refused with the es-AR message.
  await agregar(page, `${MARCA.toLowerCase()}   UNO`);
  await expect(page.getByText(t.errors.nombreDuplicado, { exact: true })).toBeVisible();
  await expect(page.getByTestId("catalogo-item").filter({ hasText: MARCA })).toHaveCount(2);
  await screenshotBoth(page, "configuracion-duplicado");

  // Rename.
  await fila(page, dos).getByRole("button", { name: t.acciones.renombrar }).click();
  const renombrar = page.getByRole("dialog", { name: formatCopy(t.renombrar.title, { nombre: dos }) });
  await renombrar.getByLabel(t.renombrar.label, { exact: true }).fill(tres);
  await renombrar.getByRole("button", { name: t.renombrar.confirm }).click();
  await expect(renombrar).toBeHidden();
  await expect(fila(page, tres)).toBeVisible();
  await expect(fila(page, dos)).toHaveCount(0);

  // Reorder, from the keyboard.
  const subir = page.getByRole("button", { name: formatCopy(t.acciones.subir, { nombre: tres }) });
  await subir.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: formatCopy(t.exito.movido, { nombre: tres }) })).toBeVisible();
  await expect.poll(async () => (await nombresEnOrden(page)).slice(-2)).toEqual([tres, uno]);
  // Now last: it cannot go further down.
  await expect(page.getByRole("button", { name: formatCopy(t.acciones.bajar, { nombre: uno }) })).toBeDisabled();

  // Deactivate (with confirmation) and reactivate.
  await fila(page, tres).getByRole("button", { name: t.acciones.desactivar }).click();
  const desactivar = page.getByRole("dialog", { name: formatCopy(t.desactivar.title, { nombre: tres }) });
  await expect(desactivar.getByText(t.desactivar.body)).toBeVisible();
  await desactivar.getByRole("button", { name: t.desactivar.confirm }).click();
  await expect(desactivar).toBeHidden();
  await expect(fila(page, tres).getByText(t.estados.inactivo, { exact: true })).toBeVisible();
  await fila(page, tres).getByRole("button", { name: t.acciones.reactivar }).click();
  await expect(fila(page, tres).getByText(t.estados.activo, { exact: true })).toBeVisible();

  // Delete an unused item (with confirmation).
  await fila(page, uno).getByRole("button", { name: t.acciones.eliminar }).click();
  const eliminar = page.getByRole("dialog", { name: formatCopy(t.eliminar.title, { nombre: uno }) });
  await eliminar.getByRole("button", { name: t.eliminar.confirm }).click();
  await expect(eliminar).toBeHidden();
  await expect(fila(page, uno)).toHaveCount(0);
  await screenshotBoth(page, "configuracion-sucursales");

  // History, newest first, naming the Admin.
  await page.getByRole("link", { name: t.acciones.verHistorial }).click();
  await expect(page).toHaveURL(/\/configuracion\/historial$/);
  await expect(page.getByRole("heading", { level: 1, name: t.historial.title })).toBeVisible();
  const propias = page.getByTestId("historial-row").filter({ hasText: MARCA });
  await expect(propias).toHaveCount(8);
  const acciones = (await propias.allInnerTexts()).map((texto) => texto.split("\t")[4]?.trim() ?? texto);
  expect(acciones).toEqual([
    t.historial.acciones.baja,
    t.historial.acciones.reactivacion,
    t.historial.acciones.desactivacion,
    t.historial.acciones.reorden,
    t.historial.acciones.reorden,
    t.historial.acciones.renombre,
    t.historial.acciones.alta,
    t.historial.acciones.alta,
  ]);
  const renombre = propias.filter({ hasText: t.historial.acciones.renombre });
  for (const texto of [admin.email, t.listas.sucursal, dos, tres]) {
    await expect(renombre.getByText(texto, { exact: true }).first()).toBeVisible();
  }
  // No internal id reaches the page (AUDCR1-01). Test accounts' emails carry
  // a random UUID, so the emails are taken out first.
  const texto = (await page.locator("main").innerText()).replace(/\S+@mitsm\.test/g, "");
  expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  await screenshotBoth(page, "configuracion-historial");
});

test("an Empleado does not see Configuración and cannot open it", async ({ page }) => {
  const empleado = await createE2EUser(`configuracion-empleado-${randomUUID().slice(0, 8)}`);
  cuentas.add(empleado.id);
  await loginAs(page, empleado);
  await expectNavLinks(page, [copy.nav.miLegajo]);
  for (const path of ["/configuracion", "/configuracion/historial", "/configuracion?lista=puesto"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/mi-legajo$/);
  }
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toHaveCount(0);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/configuracion-empleado-redirigido.png`, fullPage: true });
});
