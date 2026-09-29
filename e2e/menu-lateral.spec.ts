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

// The sidebar/drawer content is centered: the logo, each nav item (number
// and label as a unit) and the footer controls. The active item is
// underlined in the accent color; the others are not.
async function contenidoCentrado(page: Page) {
  const aside = page.locator("aside#app-sidebar");
  expect(await centrado(logo(aside), aside)).toBeLessThanOrEqual(1.5);
  const items = aside.getByTestId("nav-item");
  expect(await items.count()).toBeGreaterThan(0);
  for (const item of await items.all()) expect(await centrado(item, aside)).toBeLessThanOrEqual(1.5);
  for (const control of [aside.getByRole("button", { name: copy.auth.logout }), aside.getByText(copy.auth.roles.empleado, { exact: true })]) {
    expect(await centrado(control, aside)).toBeLessThanOrEqual(1.5);
  }
  const subrayado = (item: Locator) => item.evaluate((el) => getComputedStyle(el).borderBottomColor);
  const activo = aside.locator('a[aria-current="page"]').getByTestId("nav-item");
  expect(await subrayado(activo)).not.toBe("rgba(0, 0, 0, 0)");
  for (const otro of await aside.locator('a:not([aria-current="page"])').getByTestId("nav-item").all()) {
    expect(await subrayado(otro)).toBe("rgba(0, 0, 0, 0)");
  }
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
  await contenidoCentrado(page);
  await expect(ocultar).toHaveAttribute("aria-expanded", "true");
  // Shown: the button is at the right of the menu's top row.
  const [menu, enMenu] = [await aside.boundingBox(), await ocultar.boundingBox()];
  expect(enMenu!.x).toBeGreaterThan(menu!.x + menu!.width / 2);
  expect(enMenu!.x + enMenu!.width).toBeLessThanOrEqual(menu!.x + menu!.width);
  await screenshotBoth(page, "menu-visible");

  await ocultar.click();
  await expect(nav).toBeHidden();
  await expect(mostrar).toHaveAttribute("aria-expanded", "false");
  // The page takes the width, clear of the button.
  const box = await titulo(page).boundingBox();
  expect(box!.x).toBeLessThan(234);
  const boton = await mostrar.boundingBox();
  // Hidden: the button is at the page's top left corner.
  expect(boton!.x).toBeLessThan(20);
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

test("below 900px: the logo is centered in the top bar and the hamburger, at its right end, opens the menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, await usuario("menu-movil"));
  const barra = page.locator("div.sticky").first();
  expect(await centrado(logo(barra), barra)).toBeLessThanOrEqual(1);
  // The wide-screen button is not shown here.
  await expect(page.getByRole("button", { name: copy.common.ocultarMenu })).toBeHidden();

  const abrir = page.getByRole("button", { name: copy.common.openMenu });
  await expect(abrir).toHaveAttribute("aria-expanded", "false");
  const [barraBox, abrirBox] = [await barra.boundingBox(), await abrir.boundingBox()];
  expect(abrirBox!.x + abrirBox!.width).toBeGreaterThan(barraBox!.x + barraBox!.width - 30);
  await abrir.click();
  await expect(mainNav(page)).toBeVisible();
  await contenidoCentrado(page);
  await screenshotBoth(page, "menu-movil-abierto");
});

// The theme switch (icon only) and the bell sit in the top right corner, at
// every width, and no longer in the side menu. Left to right: the switch, the
// bell and, below 900px, the menu button at the right end.
for (const { ancho, alto } of [
  { ancho: 1280, alto: 800 },
  { ancho: 390, alto: 844 },
]) {
  test(`${ancho}px: the theme switch, the bell (and the menu button below 900px) are in the top right corner`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const admin = await createE2EUser("menu-esquina", "admin");
    creados.push(admin.id);
    await loginAs(page, admin);

    const tema = page.getByRole("button", { name: copy.theme.toDark });
    const campana = page.getByTestId("campana").filter({ visible: true });
    await expect(tema).toBeVisible();
    await expect(campana).toHaveCount(1);
    // Icon only: no visible text.
    expect((await tema.innerText()).trim()).toBe("");

    const [t, c] = [await tema.boundingBox(), await campana.boundingBox()];
    // In the corner: at the top, in the right half (below 900px the menu
    // button takes the right end, so the switch may sit further left).
    for (const box of [t!, c!]) {
      expect(box.y).toBeLessThan(20);
      expect(box.x).toBeGreaterThan(ancho / 2);
    }
    // The switch, then the bell.
    expect(t!.x + t!.width).toBeLessThanOrEqual(c!.x);
    if (ancho < 900) {
      // The menu button at the right end, the bell immediately to its left.
      const m = await page.getByRole("button", { name: copy.common.openMenu }).boundingBox();
      expect(c!.x + c!.width).toBeLessThanOrEqual(m!.x);
      expect(m!.x - (c!.x + c!.width)).toBeLessThanOrEqual(12);
      expect(m!.x + m!.width).toBeGreaterThan(ancho - 30);
    }

    // Not in the side menu any more.
    const aside = page.locator("aside#app-sidebar");
    await expect(aside.getByTestId("theme-toggle")).toHaveCount(0);
    await expect(aside.getByTestId("campana")).toHaveCount(0);

    // It still switches, and the icon's name follows.
    await tema.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: copy.theme.toLight })).toBeVisible();
    await screenshotBoth(page, `esquina-${ancho}`);
  });
}
