import { expect, test } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import {
  ADMIN,
  EMPLEADO_A,
  EMPLEADO_B,
  fillLogin,
  loginAs,
  mainNav,
  SCREENSHOT_DIR,
  setThemeCookie,
} from "./helpers";

test.describe("login page", () => {
  test("renders in light and dark", async ({ page }) => {
    await page.goto("/login");
    const html = page.locator("html");
    const title = page.getByRole("heading", { level: 1, name: copy.auth.login.title });

    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(title).toBeVisible();
    await expect(page.getByLabel(copy.auth.login.emailLabel, { exact: true })).toBeVisible();
    await expect(page.getByLabel(copy.auth.login.passwordLabel, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.auth.login.submit })).toBeVisible();
    await expect(page.getByRole("img", { name: copy.app.logoAlt })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/login-light.png`, fullPage: true });

    await setThemeCookie(page, "dark");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(title).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/login-dark.png`, fullPage: true });
  });

  test("wrong password shows the generic error", async ({ page }) => {
    await fillLogin(page, EMPLEADO_A.email, "wrong-password");
    await expect(page.getByRole("alert")).toHaveText(copy.auth.errors.invalidCredentials);
    await expect(page).toHaveURL(/\/login$/);
  });

  test("unknown email shows the same generic error", async ({ page }) => {
    await fillLogin(page, "nobody@mitsm.test", "wrong-password");
    await expect(page.getByRole("alert")).toHaveText(copy.auth.errors.invalidCredentials);
  });
});

test.describe("session and menu", () => {
  test("unauthenticated visit to /mi-legajo redirects to /login", async ({ page }) => {
    await page.goto("/mi-legajo");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("empleado lands on /mi-legajo and sees only Mi Legajo", async ({ page }) => {
    await loginAs(page, EMPLEADO_A);
    await expect(
      page.getByRole("heading", { level: 1, name: copy.miLegajo.title }),
    ).toBeVisible();

    const links = mainNav(page).getByRole("link");
    await expect(links).toHaveCount(1);
    await expect(links).toHaveText([copy.nav.miLegajo]);
    await expect(links.first()).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(copy.auth.roles.empleado, { exact: true })).toBeVisible();
    await expect(page.getByTestId("user-email")).toHaveText(EMPLEADO_A.email);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/shell-empleado-light.png`, fullPage: true });

    await setThemeCookie(page, "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/shell-empleado-dark.png`, fullPage: true });
  });

  test("admin sees Mi Legajo, Legajos and Usuarios", async ({ page }) => {
    await loginAs(page, ADMIN);

    const links = mainNav(page).getByRole("link");
    await expect(links).toHaveText([copy.nav.miLegajo, copy.nav.legajos, copy.nav.usuarios]);
    await expect(page.getByText(copy.auth.roles.admin, { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/shell-admin-light.png`, fullPage: true });

    await links.nth(1).click();
    await expect(page).toHaveURL(/\/legajos$/);
    await expect(page.getByRole("heading", { level: 1, name: copy.legajos.title })).toBeVisible();
    await expect(links.nth(1)).toHaveAttribute("aria-current", "page");

    await setThemeCookie(page, "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/shell-admin-dark.png`, fullPage: true });
  });

  test("below 900px the menu opens from the top bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, ADMIN);

    const nav = mainNav(page);
    await expect(nav).toBeHidden();
    await page.getByRole("button", { name: copy.common.openMenu }).click();
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(3);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/shell-admin-mobile-menu.png` });

    await nav.getByRole("link", { name: copy.nav.usuarios }).click();
    await expect(page).toHaveURL(/\/usuarios$/);
    await expect(nav).toBeHidden();
  });
});

test.describe("theme and logout", () => {
  test("theme toggle switches data-theme and persists after reload", async ({ page }) => {
    await loginAs(page, EMPLEADO_A);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: copy.theme.toDark }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: copy.theme.toLight })).toBeVisible();

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: copy.theme.toLight })).toBeVisible();

    await page.getByRole("button", { name: copy.theme.toLight }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
  });

  test("logout returns to /login and /mi-legajo is no longer reachable", async ({ page }) => {
    // Dedicated user: signing out ends this user's sessions, so no other test uses it.
    await loginAs(page, EMPLEADO_B);
    await page.getByRole("button", { name: copy.auth.logout }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/mi-legajo");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("/ and /login redirect to /mi-legajo when a session exists", async ({ page }) => {
    await loginAs(page, ADMIN);
    await page.goto("/");
    await expect(page).toHaveURL(/\/mi-legajo$/);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/mi-legajo$/);
  });
});
