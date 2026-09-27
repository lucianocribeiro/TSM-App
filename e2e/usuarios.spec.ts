import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { ADMIN, EMPLEADO_A, fillLogin, loginAs, loginError, SCREENSHOT_DIR } from "./helpers";
import { createE2EUser, deleteE2EUser, deleteE2EUserByEmail, localServiceClient } from "./service";

// F1-07B: the Usuarios screen (PRD US-5, US-8, US-9). The steps run in order
// on one throwaway account, so its history can be checked at the end. The
// Admin acting is the seed Admin; other accounts are created and removed here.

const t = copy.usuarios;
const SUFFIX = randomUUID().slice(0, 8);
const APELLIDO = `Objetivo${SUFFIX}`;

let target: { id: string; email: string; password: string };
let resetPassword = "";
const createdEmails: string[] = [];

function rowFor(page: Page, email: string) {
  return page.getByTestId("cuenta-row").filter({ hasText: email });
}

async function openUsuarios(page: Page) {
  await page.goto("/usuarios");
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
}

async function search(page: Page, text: string) {
  await page.getByLabel(t.busqueda.label, { exact: true }).fill(text);
}

async function showAll(page: Page) {
  await page.getByRole("group", { name: t.filtro.label }).getByRole("button", { name: t.filtro.todas }).click();
}

// Switches the theme in place, as the theme toggle does, so page state (an
// open dialog, the password shown once) survives for the dark screenshot.
async function screenshotBoth(page: Page, name: string) {
  const html = page.locator("html");
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}-light.png`, fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}-dark.png`, fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
}

// Signs in as another user in a separate browser context; returns where it lands.
async function loginElsewhere(browser: Browser, email: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await fillLogin(page, email, password);
  return { page, close: () => context.close() };
}

test.describe("Usuarios (Admin)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    target = await createE2EUser(`usuarios-${SUFFIX}`);
    const named = await localServiceClient()
      .from("legajos")
      .update({ nombres: "Prueba", apellido: APELLIDO })
      .eq("profile_id", target.id);
    if (named.error) throw new Error(`legajo setup failed: ${named.error.message}`);
  });

  test.afterAll(async () => {
    for (const email of createdEmails) await deleteE2EUserByEmail(email);
    await deleteE2EUser(target.id);
  });

  test("an Empleado cannot reach /usuarios or an account's detail", async ({ page }) => {
    await loginAs(page, EMPLEADO_A);
    await page.goto("/usuarios");
    await expect(page).toHaveURL(/\/mi-legajo$/);
    await expect(page.getByTestId("cuenta-row")).toHaveCount(0);

    await page.goto(`/usuarios/${target.id}`);
    await expect(page).toHaveURL(/\/mi-legajo$/);
    await expect(page.getByText(target.email)).toHaveCount(0);
  });

  test("the Admin sees the list; inactive accounts need the filter; search by email and name", async ({ page }) => {
    await loginAs(page, ADMIN);
    await openUsuarios(page);
    await expect(rowFor(page, EMPLEADO_A.email)).toHaveCount(1);
    await expect(rowFor(page, "empleado.inactivo@mitsm.test")).toHaveCount(0);

    await showAll(page);
    const inactive = rowFor(page, "empleado.inactivo@mitsm.test");
    await expect(inactive).toHaveCount(1);
    await expect(inactive.getByText(copy.cuentas.estados.inactiva, { exact: true })).toBeVisible();
    await screenshotBoth(page, "usuarios-lista");

    await search(page, target.email.toUpperCase());
    await expect(page.getByTestId("cuenta-row")).toHaveCount(1);
    await expect(rowFor(page, target.email)).toHaveCount(1);

    await search(page, `prueba ${APELLIDO.toLowerCase()}`);
    await expect(page.getByTestId("cuenta-row")).toHaveCount(1);
    await expect(rowFor(page, target.email)).toContainText(`Prueba ${APELLIDO}`);

    await search(page, `nadie-${SUFFIX}`);
    await expect(page.getByTestId("cuenta-row")).toHaveCount(0);
    await expect(page.getByText(t.sinResultados)).toBeVisible();
  });

  test("the Admin creates a user; the password is shown once; the user must change it at first login", async ({ page, browser }) => {
    const email = `e2e.nuevo.${SUFFIX}@mitsm.test`;
    createdEmails.push(email);
    await loginAs(page, ADMIN);
    await openUsuarios(page);

    await page.getByRole("button", { name: t.nuevoUsuario }).click();
    const form = page.getByRole("dialog", { name: t.crear.title });
    await form.getByLabel(t.crear.emailLabel, { exact: true }).fill(email);
    await form.getByRole("button", { name: t.crear.generar }).click();
    const passwordField = form.getByLabel(t.crear.passwordLabel, { exact: true });
    const password = await passwordField.inputValue();
    expect(password.length).toBeGreaterThanOrEqual(8);
    await screenshotBoth(page, "usuarios-crear");
    await form.getByRole("button", { name: t.crear.submit }).click();

    const shown = page.getByRole("dialog", { name: t.passwordUnaVez.title });
    await expect(shown.getByTestId("password-una-vez")).toHaveText(password);
    await expect(shown.getByText(t.passwordUnaVez.note)).toBeVisible();
    await screenshotBoth(page, "usuarios-password-una-vez");
    await shown.getByRole("button", { name: t.passwordUnaVez.listo }).click();
    await expect(page.getByText(password)).toHaveCount(0);

    await search(page, email);
    const row = rowFor(page, email);
    await expect(row).toHaveCount(1);
    await expect(row.getByText(t.passwordPendiente)).toBeVisible();

    const other = await loginElsewhere(browser, email, password);
    await expect(other.page).toHaveURL(/\/cambiar-password$/);
    await other.close();

    // Shown once: gone after a reload too.
    await page.reload();
    await expect(page.getByText(password)).toHaveCount(0);
  });

  test("the Admin resets a temporary password; the user must change it at next login", async ({ page, browser }) => {
    await loginAs(page, ADMIN);
    await openUsuarios(page);
    await search(page, target.email);
    await rowFor(page, target.email).getByRole("button", { name: t.acciones.restablecer }).click();

    const dialog = page.getByRole("dialog", { name: t.restablecer.title });
    await expect(dialog.getByText(target.email)).toBeVisible();
    await dialog.getByRole("button", { name: t.crear.generar }).click();
    resetPassword = await dialog.getByLabel(t.crear.passwordLabel, { exact: true }).inputValue();
    await dialog.getByRole("button", { name: t.restablecer.confirm }).click();

    const shown = page.getByRole("dialog", { name: t.passwordUnaVez.title });
    await expect(shown.getByTestId("password-una-vez")).toHaveText(resetPassword);
    await shown.getByRole("button", { name: t.passwordUnaVez.listo }).click();
    await expect(rowFor(page, target.email).getByText(t.passwordPendiente)).toBeVisible();

    const old = await loginElsewhere(browser, target.email, target.password);
    await expect(loginError(old.page)).toHaveText(copy.auth.errors.invalidCredentials);
    await old.close();
    const fresh = await loginElsewhere(browser, target.email, resetPassword);
    await expect(fresh.page).toHaveURL(/\/cambiar-password$/);
    await fresh.close();
  });

  test("the Admin deactivates an account with a reason; it leaves the default list and cannot log in", async ({ page, browser }) => {
    await loginAs(page, ADMIN);
    await openUsuarios(page);
    await search(page, target.email);
    await rowFor(page, target.email).getByRole("button", { name: t.acciones.desactivar }).click();

    const dialog = page.getByRole("dialog", { name: t.desactivar.title });
    const confirm = dialog.getByRole("button", { name: t.desactivar.confirm });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(t.desactivar.motivoLabel, { exact: true }).fill("   ");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(t.desactivar.motivoLabel, { exact: true }).fill("Fin del contrato (prueba)");
    await confirm.click();

    await expect(page.getByRole("status").filter({ hasText: t.exito.desactivada })).toBeVisible();
    await expect(rowFor(page, target.email)).toHaveCount(0);
    await showAll(page);
    await expect(rowFor(page, target.email).getByText(copy.cuentas.estados.inactiva, { exact: true })).toBeVisible();

    const blocked = await loginElsewhere(browser, target.email, resetPassword);
    await expect(loginError(blocked.page)).toHaveText(copy.auth.errors.cuentaInactiva);
    await blocked.close();
  });

  test("the Admin reactivates the account and the user can log in again", async ({ page, browser }) => {
    await loginAs(page, ADMIN);
    await openUsuarios(page);
    await showAll(page);
    await search(page, target.email);
    await rowFor(page, target.email).getByRole("button", { name: t.acciones.reactivar }).click();
    await page.getByRole("dialog", { name: t.reactivar.title }).getByRole("button", { name: t.reactivar.confirm }).click();

    await expect(rowFor(page, target.email).getByText(copy.cuentas.estados.activa, { exact: true })).toBeVisible();
    const back = await loginElsewhere(browser, target.email, resetPassword);
    // Signed in; the temporary password from the reset still has to be changed.
    await expect(back.page).toHaveURL(/\/cambiar-password$/);
    await back.close();
  });

  test("purge needs the exact email: a wrong one does nothing, the right one removes the account", async ({ page }) => {
    const throwaway = await createE2EUser(`purga-${SUFFIX}`);
    try {
      await loginAs(page, ADMIN);
      await openUsuarios(page);
      await search(page, throwaway.email);
      await rowFor(page, throwaway.email).getByRole("button", { name: t.acciones.purgar }).click();

      const dialog = page.getByRole("dialog", { name: t.purgar.title });
      await expect(dialog.getByText(/para siempre/)).toBeVisible();
      const emailField = dialog.getByLabel(t.purgar.emailLabel, { exact: true });
      await emailField.fill(throwaway.email.toUpperCase());
      await dialog.getByRole("button", { name: t.purgar.confirm }).click();
      await expect(dialog.getByRole("alert")).toHaveText(copy.cuentas.errors.emailConfirmacionNoCoincide);
      await dialog.getByRole("button", { name: t.acciones.cancelar }).click();
      await expect(rowFor(page, throwaway.email)).toHaveCount(1);

      await rowFor(page, throwaway.email).getByRole("button", { name: t.acciones.purgar }).click();
      await dialog.getByLabel(t.purgar.emailLabel, { exact: true }).fill(throwaway.email);
      await dialog.getByRole("button", { name: t.purgar.confirm }).click();
      await expect(page.getByRole("status").filter({ hasText: t.exito.purgada })).toBeVisible();
      await showAll(page);
      await expect(rowFor(page, throwaway.email)).toHaveCount(0);

      const { data } = await localServiceClient().auth.admin.getUserById(throwaway.id);
      expect(data.user).toBeNull();
    } finally {
      await deleteE2EUser(throwaway.id);
    }
  });

  test("the Admin's own row offers no action", async ({ page }) => {
    await loginAs(page, ADMIN);
    await openUsuarios(page);
    await search(page, ADMIN.email);
    const own = rowFor(page, ADMIN.email);
    await expect(own).toHaveCount(1);
    await expect(own.getByText(t.tuCuenta)).toBeVisible();
    await expect(own.getByRole("button")).toHaveCount(0);
  });

  test("the account detail shows the history of the steps above, with who and when", async ({ page }) => {
    await loginAs(page, ADMIN);
    await openUsuarios(page);
    await search(page, target.email);
    await rowFor(page, target.email).getByRole("cell").first().click();
    await expect(page).toHaveURL(new RegExp(`/usuarios/${target.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: `Prueba ${APELLIDO}` })).toBeVisible();

    const events = page.getByTestId("evento-row");
    // Newest first: reactivation, deactivation (with its reason), temporary password.
    await expect(events).toHaveCount(3);
    await expect(events.nth(0)).toContainText(copy.cuentas.eventos.reactivacion);
    await expect(events.nth(1)).toContainText(copy.cuentas.eventos.desactivacion);
    await expect(events.nth(1)).toContainText("Fin del contrato (prueba)");
    await expect(events.nth(2)).toContainText(copy.cuentas.eventos.password_temporal);
    for (let i = 0; i < 3; i += 1) {
      // Who: the seed Admin's legajo name. When: dd/mm/yyyy, hh:mm.
      await expect(events.nth(i)).toContainText("Prueba Admin Ficticio");
      await expect(events.nth(i)).toContainText(/\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}/);
    }
    await screenshotBoth(page, "usuarios-detalle");

    await page.getByRole("link", { name: t.detalle.volver }).click();
    await expect(page).toHaveURL(/\/usuarios$/);
  });
});

test.describe("menu", () => {
  test("every signed-in user has a link to change their password", async ({ page }) => {
    await loginAs(page, EMPLEADO_A);
    await page.getByRole("link", { name: copy.nav.cambiarPassword }).click();
    await expect(page).toHaveURL(/\/cambiar-password$/);
    await expect(page.getByLabel(copy.password.actualLabel, { exact: true })).toBeVisible();
  });
});
