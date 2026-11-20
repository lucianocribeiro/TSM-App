import { expect, test, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { formatCopy } from "../src/lib/copy/format";
import { copyMisRecibos } from "../src/lib/copy/mis-recibos";
import { copyRecibos } from "../src/lib/copy/recibos";
import { adminNuevo, registro } from "./datos";
import { loginAs } from "./helpers";
import { contarSinFirmar, firmaRegistrada, reciboPublicado } from "./recibos-datos";
import { screenshotBoth } from "./screens";
import { createE2EUser, fillLegajo } from "./service";

// F2-06, PRD Fase 2 RF-22: the "Recibos sin firmar" card on Legajos shows
// the number of employees with a pending receipt in a visible period, and
// it goes down once the test employee signs their only one. The number is
// global, so this file runs in the "serial" project, after every other
// test (playwright.config.ts); the expected value is read from the database
// with the same definition. Invented names only.

const cuentas = registro();
test.afterAll(cuentas.limpiar);

const tarjeta = (page: Page) => page.locator('[data-kpi="recibos-sin-firmar"]');

test("Legajos: the card shows the count, links to Estado de firmas, and goes down after the employee signs", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const admin = await adminNuevo("kpi-admin", cuentas.add);
  const empleado = await createE2EUser("kpi-empleado");
  cuentas.add(empleado.id);
  await fillLegajo(empleado.id, { nombres: "Prueba", apellido: "Tarjeta" });
  await firmaRegistrada(empleado.id);
  const recibo = await reciboPublicado(empleado.id, admin.id);

  const antes = await contarSinFirmar();
  expect(antes).toBeGreaterThanOrEqual(1);
  await loginAs(page, admin);
  await page.goto("/legajos");
  await expect(tarjeta(page)).toContainText(copy.legajos.kpi.recibosSinFirmar);
  await expect(tarjeta(page).locator("dd").first()).toHaveText(String(antes));
  await expect(page.locator("[data-kpi]")).toHaveCount(1);
  await screenshotBoth(page, "legajos-recibos-sin-firmar");

  // The employee signs their only pending receipt, in their own session.
  const contexto = await browser.newContext();
  const suya = await contexto.newPage();
  await loginAs(suya, empleado);
  await suya.goto("/mis-recibos");
  const fila = suya
    .getByRole("list", { name: copyMisRecibos.lista.label })
    .getByRole("listitem", { name: formatCopy(copyMisRecibos.lista.periodo, { periodo: recibo.etiqueta }) });
  await fila.getByRole("button", { name: copyMisRecibos.acciones.firmar }).click();
  await suya
    .getByRole("dialog", { name: formatCopy(copyMisRecibos.firmar.title, { periodo: recibo.etiqueta }) })
    .getByRole("button", { name: copyMisRecibos.firmar.confirmar })
    .click();
  await expect(fila.getByText(copyMisRecibos.estados.firmado, { exact: true })).toBeVisible();
  await contexto.close();

  const despues = await contarSinFirmar();
  expect(despues).toBe(antes - 1);
  await page.reload();
  await expect(tarjeta(page).locator("dd").first()).toHaveText(String(despues));

  // The card leads to Estado de firmas.
  await tarjeta(page).getByRole("link", { name: copy.legajos.kpi.verEstado }).click();
  await expect(page).toHaveURL(/\/recibos\/estado$/);
  await expect(page.getByRole("heading", { level: 1, name: copyRecibos.estado.title })).toBeVisible();
});
