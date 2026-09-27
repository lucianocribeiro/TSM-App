import { expect, test } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import {
  EMPLEADO_B,
  EMPLEADO_INACTIVO,
  expectNavLinks,
  fillLogin,
  loginAs,
  loginError,
  mainNav,
  SCREENSHOT_DIR,
  SEED_PASSWORD,
  setThemeCookie,
} from "./helpers";
import { createE2EUser, deleteE2EUser, localServiceClient } from "./service";

// F1-07A: forced password change (PRD US-9) and inactive accounts (US-8).

const NEW_PASSWORD = "NuevaClaveE2E-1";

async function fillCambioPassword(
  page: import("@playwright/test").Page,
  password: string,
  confirmacion = password,
  actual?: string,
) {
  if (actual !== undefined) {
    await page.getByLabel(copy.password.actualLabel, { exact: true }).fill(actual);
  }
  await page.getByLabel(copy.password.nuevaLabel, { exact: true }).fill(password);
  await page.getByLabel(copy.password.confirmacionLabel, { exact: true }).fill(confirmacion);
  await page.getByRole("button", { name: copy.password.submit }).click();
}

// Empleado B has a temporary password in the seed. These tests change it, so
// they run one at a time and put the seed state back before and after.
test.describe("forced password change", () => {
  test.describe.configure({ mode: "serial" });

  async function resetEmpleadoB() {
    const service = localServiceClient();
    const { error } = await service.auth.admin.updateUserById(EMPLEADO_B.id, { password: SEED_PASSWORD });
    if (error) throw new Error(`reset failed: ${error.message}`);
    const flag = await service.from("profiles").update({ debe_cambiar_password: true }).eq("id", EMPLEADO_B.id);
    if (flag.error) throw new Error(`reset failed: ${flag.error.message}`);
  }

  test.beforeEach(resetEmpleadoB);
  test.afterEach(resetEmpleadoB);

  test("the change-password page renders in light and dark, with no navigation", async ({ page }) => {
    await fillLogin(page, EMPLEADO_B.email, EMPLEADO_B.password);
    await expect(page).toHaveURL(/\/cambiar-password$/);

    const html = page.locator("html");
    const title = page.getByRole("heading", { level: 1, name: copy.password.title });
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(title).toBeVisible();
    await expect(page.getByLabel(copy.password.nuevaLabel, { exact: true })).toBeVisible();
    await expect(page.getByLabel(copy.password.confirmacionLabel, { exact: true })).toBeVisible();
    // Forced change: two fields only, no current password.
    await expect(page.getByLabel(copy.password.actualLabel, { exact: true })).toHaveCount(0);
    await expect(page.locator('form input:not([type="hidden"])')).toHaveCount(2);
    await expect(mainNav(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.auth.logout })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/cambiar-password-light.png`, fullPage: true });

    await setThemeCookie(page, "dark");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(title).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/cambiar-password-dark.png`, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/cambiar-password-dark-390.png`, fullPage: true });
  });

  test("only /cambiar-password is reachable until the change is done; then /mi-legajo, and later logins go straight there", async ({ page }) => {
    await fillLogin(page, EMPLEADO_B.email, EMPLEADO_B.password);
    await expect(page).toHaveURL(/\/cambiar-password$/);

    for (const path of ["/mi-legajo", "/legajos", "/usuarios", "/", "/login"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/cambiar-password$/);
    }
    await expect(page.getByLabel(copy.password.actualLabel, { exact: true })).toHaveCount(0);

    // Server-side validation.
    await fillCambioPassword(page, NEW_PASSWORD, `${NEW_PASSWORD}x`);
    await expect(page.locator("form").getByRole("alert")).toHaveText(copy.password.errors.noCoinciden);
    await fillCambioPassword(page, SEED_PASSWORD);
    await expect(page.locator("form").getByRole("alert")).toHaveText(copy.password.errors.igualActual);
    await expect(page).toHaveURL(/\/cambiar-password$/);

    await fillCambioPassword(page, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/mi-legajo$/);
    await expect(page.getByRole("heading", { level: 1, name: copy.miLegajo.title })).toBeVisible();
    await expectNavLinks(page, [copy.nav.miLegajo]);

    // Still reachable, now as a voluntary change with the usual navigation,
    // which asks for the current password.
    await page.goto("/cambiar-password");
    await expect(page).toHaveURL(/\/cambiar-password$/);
    await expect(page.getByText(copy.password.introVoluntaria)).toBeVisible();
    await expect(page.getByLabel(copy.password.actualLabel, { exact: true })).toBeVisible();
    await expectNavLinks(page, [copy.nav.miLegajo]);

    await page.getByRole("button", { name: copy.auth.logout }).click();
    await expect(page).toHaveURL(/\/login$/);

    await fillLogin(page, EMPLEADO_B.email, SEED_PASSWORD);
    await expect(loginError(page)).toHaveText(copy.auth.errors.invalidCredentials);
    await loginAs(page, { email: EMPLEADO_B.email, password: NEW_PASSWORD });
  });
});

test.describe("voluntary password change", () => {
  test("an Admin changes their own password at /cambiar-password, giving the current one", async ({ page, browser }) => {
    const user = await createE2EUser("admin-cambio", "admin");
    try {
      await loginAs(page, user);
      await page.goto("/cambiar-password");
      await expect(page).toHaveURL(/\/cambiar-password$/);
      await expect(page.getByText(copy.password.introVoluntaria)).toBeVisible();
      await expect(page.getByLabel(copy.password.actualLabel, { exact: true })).toBeVisible();
      await expect(page.locator('form input:not([type="hidden"])')).toHaveCount(3);
      await expectNavLinks(page, [copy.nav.miLegajo, copy.nav.legajos, copy.nav.usuarios]);

      const html = page.locator("html");
      await expect(html).toHaveAttribute("data-theme", "light");
      await page.screenshot({ path: `${SCREENSHOT_DIR}/cambiar-password-voluntario-light.png`, fullPage: true });
      await setThemeCookie(page, "dark");
      await page.reload();
      await expect(html).toHaveAttribute("data-theme", "dark");
      await page.screenshot({ path: `${SCREENSHOT_DIR}/cambiar-password-voluntario-dark.png`, fullPage: true });

      // A wrong current password changes nothing.
      await fillCambioPassword(page, NEW_PASSWORD, NEW_PASSWORD, "NoEsLaActual-1");
      await expect(page.locator("form").getByRole("alert")).toHaveText(copy.password.errors.actualIncorrecta);
      await expect(page).toHaveURL(/\/cambiar-password$/);
      const other = await browser.newContext();
      try {
        const otherPage = await other.newPage();
        await loginAs(otherPage, user);
      } finally {
        await other.close();
      }

      // The correct one completes the change, and this session survives.
      await fillCambioPassword(page, NEW_PASSWORD, NEW_PASSWORD, user.password);
      await expect(page).toHaveURL(/\/mi-legajo$/);
      await mainNav(page).getByRole("link", { name: copy.nav.legajos }).click();
      await expect(page).toHaveURL(/\/legajos$/);
      await page.reload();
      await expect(page).toHaveURL(/\/legajos$/);
      await expect(page.getByTestId("user-email")).toHaveText(user.email);

      await page.getByRole("button", { name: copy.auth.logout }).click();
      await expect(page).toHaveURL(/\/login$/);
      await fillLogin(page, user.email, user.password);
      await expect(loginError(page)).toHaveText(copy.auth.errors.invalidCredentials);
      await loginAs(page, { email: user.email, password: NEW_PASSWORD });
    } finally {
      await deleteE2EUser(user.id);
    }
  });
});

test.describe("inactive accounts", () => {
  test("a deactivated user cannot log in and sees the inactive-account message", async ({ page }) => {
    await fillLogin(page, EMPLEADO_INACTIVO.email, EMPLEADO_INACTIVO.password);
    await expect(loginError(page)).toHaveText(copy.auth.errors.cuentaInactiva);
    await expect(page).toHaveURL(/\/login$/);
  });

  // AUD07A-02: the gate fails closed. The profile row is removed under a
  // signed-in user who also has a pending password change: neither the change
  // page nor any other page is reachable, and the session ends.
  test("a signed-in user whose account cannot be verified is signed out", async ({ page }) => {
    const user = await createE2EUser("sin-perfil");
    try {
      await loginAs(page, user);

      const service = localServiceClient();
      const flagged = await service.from("profiles").update({ debe_cambiar_password: true }).eq("id", user.id);
      expect(flagged.error).toBeNull();
      const removed = await service.from("profiles").delete().eq("id", user.id).select("id");
      expect(removed.data).toHaveLength(1);

      await page.goto("/cambiar-password");
      await expect(page).toHaveURL(/\/login\?cuenta=no-verificada$/);
      await expect(loginError(page)).toHaveText(copy.auth.errors.cuentaNoVerificada);

      // The session is gone.
      for (const path of ["/mi-legajo", "/cambiar-password"]) {
        await page.goto(path);
        await expect(page, path).toHaveURL(/\/login$/);
      }
    } finally {
      await deleteE2EUser(user.id);
    }
  });

  test("a signed-in user who is deactivated is signed out on the next navigation", async ({ page }) => {
    const user = await createE2EUser("baja-en-sesion");
    try {
      await loginAs(page, user);

      const service = localServiceClient();
      const { error } = await service.from("profiles").update({ estado_cuenta: "inactiva" }).eq("id", user.id);
      expect(error).toBeNull();

      await page.goto("/mi-legajo");
      await expect(page).toHaveURL(/\/login\?cuenta=inactiva$/);
      await expect(loginError(page)).toHaveText(copy.auth.errors.cuentaInactiva);

      // The session is gone.
      await page.goto("/mi-legajo");
      await expect(page).toHaveURL(/\/login$/);
    } finally {
      await deleteE2EUser(user.id);
    }
  });
});
