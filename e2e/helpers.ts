import { expect, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { THEME_COOKIE, type Theme } from "../src/lib/theme/theme";

// Local seed users (supabase/seed.sql). Local and CI test data only.
export const SEED_PASSWORD = "TestPass123!";
export const ADMIN = { email: "admin@mitsm.test", password: SEED_PASSWORD };
export const EMPLEADO_A = { email: "empleado.a@mitsm.test", password: SEED_PASSWORD };
export const EMPLEADO_B = { email: "empleado.b@mitsm.test", password: SEED_PASSWORD };

// Uploaded by CI as the e2e-screenshots artifact.
export const SCREENSHOT_DIR = "test-results/screenshots";

export async function fillLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(copy.auth.login.emailLabel, { exact: true }).fill(email);
  await page.getByLabel(copy.auth.login.passwordLabel, { exact: true }).fill(password);
  await page.getByRole("button", { name: copy.auth.login.submit }).click();
}

export async function loginAs(page: Page, user: { email: string; password: string }) {
  await fillLogin(page, user.email, user.password);
  await expect(page).toHaveURL(/\/mi-legajo$/);
}

export function mainNav(page: Page) {
  return page.getByRole("navigation", { name: copy.nav.label });
}

// Menu links in order: accessible name is the label; visible text starts with "01", "02"...
export async function expectNavLinks(page: Page, labels: string[]) {
  const links = mainNav(page).getByRole("link");
  await expect(links).toHaveCount(labels.length);
  for (const [index, label] of labels.entries()) {
    const link = links.nth(index);
    await expect(link).toHaveAccessibleName(label);
    await expect(link).toHaveText(`${String(index + 1).padStart(2, "0")}${label}`);
  }
}

// The login form error. Scoped to the form: Next.js also renders a route announcer with role="alert".
export function loginError(page: Page) {
  return page.locator("form").getByRole("alert");
}

// Sets the theme cookie for the current origin. Call after the first navigation.
export async function setThemeCookie(page: Page, theme: Theme) {
  await page
    .context()
    .addCookies([{ name: THEME_COOKIE, value: theme, url: new URL(page.url()).origin }]);
}
