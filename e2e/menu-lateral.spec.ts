import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { loginAs, mainNav } from "./helpers";
import { screenshotBoth } from "./screens";
import { createE2EUser, deleteE2EUser } from "./service";

// The side menu: the logo centered in it, and on wide screens a hamburger
// that hides and shows it, remembered per browser. Below 900px the same
// hamburger opens the menu from the top bar, with the logo centered there.

const creados: string[] = [];
test.afterAll(async () => {
  for (const id of creados) await deleteE2EUser(id);
});

async function usuario(label: string) {
  const user = await createE2EUser(label);
  creados.push(user.id);
  return user;
}

// Horizontal center of an element, and of its container.
async function centrado(elemento: Locator, contenedor: Locator) {
  const [a, b] = await Promise.all([elemento.boundingBox(), contenedor.boundingBox()]);
  if (!a || !b) throw new Error("element not rendered");
  return Math.abs(a.x + a.width / 2 - (b.x + b.width / 2));
}

const logo = (zona: Locator) => zona.getByRole("img", { name: copy.app.logoAlt });
const titulo = (page: Page) => page.getByRole("heading", { level: 1, name: copy.miLegajo.title });

test("wide screens: the logo is centered and the hamburger hides and shows the menu, remembered", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, await usuario("menu-ancho"));
  const aside = page.locator("aside#app-sidebar");
  const nav = mainNav(page);
  const ocultar = page.getByRole("button", { name: copy.common.ocultarMenu });
  const mostrar = page.getByRole("button", { name: copy.common.mostrarMenu });

  await expect(nav).toBeVisible();
  expect(await centrado(logo(aside), aside)).toBeLessThanOrEqual(1);
  await expect(ocultar).toHaveAttribute("aria-expanded", "true");
  await screenshotBoth(page, "menu-visible");

  await ocultar.click();
  await expect(nav).toBeHidden();
  await expect(mostrar).toHaveAttribute("aria-expanded", "false");
  // The page takes the width, clear of the button.
  const box = await titulo(page).boundingBox();
  expect(box!.x).toBeLessThan(234);
  const boton = await mostrar.boundingBox();
  expect(box!.x).toBeGreaterThan(boton!.x + boton!.width);
  await screenshotBoth(page, "menu-oculto");

  // Remembered after a reload.
  await page.reload();
  await expect(titulo(page)).toBeVisible();
  await expect(nav).toBeHidden();
  await expect(mostrar).toBeVisible();

  await mostrar.click();
  await expect(nav).toBeVisible();
  await page.reload();
  await expect(nav).toBeVisible();
  await expect(ocultar).toBeVisible();
});

test("below 900px: the logo is centered in the top bar and the hamburger opens the menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, await usuario("menu-movil"));
  const barra = page.locator("div.sticky").first();
  expect(await centrado(logo(barra), barra)).toBeLessThanOrEqual(1);
  // The wide-screen button is not shown here.
  await expect(page.getByRole("button", { name: copy.common.ocultarMenu })).toBeHidden();

  const abrir = page.getByRole("button", { name: copy.common.openMenu });
  await expect(abrir).toHaveAttribute("aria-expanded", "false");
  await abrir.click();
  await expect(mainNav(page)).toBeVisible();
  const aside = page.locator("aside#app-sidebar");
  expect(await centrado(logo(aside), aside)).toBeLessThanOrEqual(1);
  await screenshotBoth(page, "menu-movil-abierto");
});
