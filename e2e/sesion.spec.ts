import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { fillLogin, loginAs, loginError } from "./helpers";
import { screenshotBoth } from "./screens";
import { createE2EUser, deleteE2EUser, localServiceClient } from "./service";

// F1-10: the route guard and the inactivity limit (PRD session rules). The
// inactivity tests control the page clock (Playwright clock), never wait.

const created: string[] = [];
test.afterAll(async () => {
  for (const id of created) await deleteE2EUser(id);
});

async function usuario(label: string, rol: "empleado" | "admin" = "empleado") {
  const user = await createE2EUser(`${label}-${randomUUID().slice(0, 8)}`, rol);
  created.push(user.id);
  return user;
}

const PUBLICA = "/login";
const AUTENTICADAS = ["/mi-legajo", "/cambiar-password"];
const ADMIN = ["/legajos", "/usuarios", "/aprobaciones"];
const SIN_MAPA = "/no-existe";

// Where each path ends up for a user: path -> expected URL (path + query).
async function recorrer(page: Page, esperado: Record<string, string>) {
  for (const [path, destino] of Object.entries(esperado)) {
    await page.goto(path);
    await expect(page, path).toHaveURL((url) => url.pathname + url.search === destino);
  }
}

test.describe("access matrix", () => {
  test("anonymous: public only; the rest goes to login, keeping where to return", async ({ page }) => {
    await recorrer(page, {
      [PUBLICA]: "/login",
      "/mi-legajo": "/login?volver=%2Fmi-legajo",
      "/cambiar-password": "/login?volver=%2Fcambiar-password",
      "/legajos": "/login?volver=%2Flegajos",
      "/usuarios": "/login?volver=%2Fusuarios",
      "/aprobaciones": "/login?volver=%2Faprobaciones",
      [SIN_MAPA]: "/login",
      "/": "/login",
    });
  });

  test("Empleado: own routes; Admin and unmapped routes go to Mi Legajo", async ({ page }) => {
    await loginAs(page, await usuario("matriz-empleado"));
    await recorrer(page, {
      ...Object.fromEntries(AUTENTICADAS.map((path) => [path, path])),
      ...Object.fromEntries(ADMIN.map((path) => [path, "/mi-legajo"])),
      [SIN_MAPA]: "/mi-legajo",
      [PUBLICA]: "/mi-legajo",
    });
  });

  test("Admin: every mapped route; unmapped ones go to Mi Legajo", async ({ page }) => {
    await loginAs(page, await usuario("matriz-admin", "admin"));
    await recorrer(page, {
      ...Object.fromEntries([...AUTENTICADAS, ...ADMIN].map((path) => [path, path])),
      [SIN_MAPA]: "/mi-legajo",
      [PUBLICA]: "/mi-legajo",
    });
  });

  test("forced password change: only /cambiar-password", async ({ page }) => {
    const user = await usuario("matriz-forzado", "admin");
    await localServiceClient().from("profiles").update({ debe_cambiar_password: true }).eq("id", user.id);
    await fillLogin(page, user.email, user.password);
    await expect(page).toHaveURL(/\/cambiar-password$/);
    await recorrer(page, {
      ...Object.fromEntries([...AUTENTICADAS, ...ADMIN, SIN_MAPA, PUBLICA].map((path) => [path, "/cambiar-password"])),
    });
  });

  test("deactivated during the session: signed out on the next request, then anonymous", async ({ page }) => {
    const user = await usuario("matriz-baja", "admin");
    await loginAs(page, user);
    await localServiceClient().from("profiles").update({ estado_cuenta: "inactiva" }).eq("id", user.id);
    await page.goto("/legajos");
    await expect(page).toHaveURL(/\/login\?cuenta=inactiva$/);
    await expect(loginError(page)).toHaveText(copy.auth.errors.cuentaInactiva);
    await recorrer(page, { "/mi-legajo": "/login?volver=%2Fmi-legajo", "/aprobaciones": "/login?volver=%2Faprobaciones" });
  });

  test("after signing in, the user returns to the page that asked for it", async ({ page }) => {
    const user = await usuario("volver", "admin");
    await page.goto("/aprobaciones");
    await expect(page).toHaveURL(/\/login\?volver=%2Faprobaciones$/);
    await fillLogin(page, user.email, user.password);
    await expect(page).toHaveURL(/\/aprobaciones$/);
  });

  test("an open-redirect attempt lands on Mi Legajo", async ({ page }) => {
    const user = await usuario("volver-malo");
    await page.goto("/login?volver=%2F%2Fevil.example%2Flegajos");
    await page.getByLabel(copy.auth.login.emailLabel, { exact: true }).fill(user.email);
    await page.getByLabel(copy.auth.login.passwordLabel, { exact: true }).fill(user.password);
    await page.getByRole("button", { name: copy.auth.login.submit }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/mi-legajo$/);
  });
});

test.describe("inactivity", () => {
  const aviso = (page: Page) => page.getByRole("dialog", { name: copy.sesion.avisoTitulo });

  test("warns at 13 minutes; 'Seguir conectado' keeps the session", async ({ page }) => {
    await page.clock.install();
    await loginAs(page, await usuario("inactividad-seguir"));

    await page.clock.fastForward("12:50");
    await expect(aviso(page)).toBeHidden();
    await page.clock.fastForward("00:10");
    await expect(aviso(page)).toBeVisible();
    await expect(page.getByTestId("aviso-inactividad")).toContainText(/2:00|1:5\d/);
    await expect(page.getByTestId("aviso-inactividad")).toContainText("cambios sin guardar");
    await screenshotBoth(page, "sesion-aviso-inactividad");

    await aviso(page).getByRole("button", { name: copy.sesion.seguirConectado }).click();
    await expect(aviso(page)).toBeHidden();
    await page.clock.fastForward("12:00");
    await expect(aviso(page)).toBeHidden();
    await page.reload();
    await expect(page).toHaveURL(/\/mi-legajo$/);
  });

  test("with no action, signs out at 15 minutes with the message", async ({ page }) => {
    await page.clock.install();
    await loginAs(page, await usuario("inactividad-cierre"));
    await page.clock.fastForward("13:00");
    await expect(aviso(page)).toBeVisible();
    await page.clock.fastForward("02:00");
    await expect(page).toHaveURL(/\/login\?sesion=inactividad$/);
    await expect(loginError(page)).toHaveText(copy.auth.errors.sesionInactividad);
    await screenshotBoth(page, "sesion-login-inactividad");

    // The session is gone on the server too.
    await page.goto("/mi-legajo");
    await expect(page).toHaveURL(/\/login\?volver=%2Fmi-legajo$/);
  });

  test("'Cerrar sesión' in the warning signs out", async ({ page }) => {
    await page.clock.install();
    await loginAs(page, await usuario("inactividad-salir"));
    await page.clock.fastForward("13:00");
    await aviso(page).getByRole("button", { name: copy.sesion.cerrarSesion }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("two tabs: activity in one keeps both; signing out in one closes both", async ({ context }) => {
    const user = await usuario("inactividad-pestanas");
    const inicio = new Date("2026-10-01T12:00:00-03:00");
    const a = await context.newPage();
    const b = await context.newPage();
    await a.clock.install({ time: inicio });
    await b.clock.install({ time: inicio });
    await loginAs(a, user);
    await b.goto("/mi-legajo");
    await expect(b).toHaveURL(/\/mi-legajo$/);

    await a.clock.fastForward("10:00");
    await b.clock.fastForward("10:00");
    // Real input in tab A only.
    await a.keyboard.press("Shift");
    await a.clock.fastForward("05:00");
    await b.clock.fastForward("05:00");
    // 15 minutes since B's own activity, 5 since A's: nobody is warned.
    await expect(aviso(b)).toBeHidden();
    await expect(aviso(a)).toBeHidden();
    await expect(b).toHaveURL(/\/mi-legajo$/);

    await a.getByRole("button", { name: copy.auth.logout }).click();
    await expect(a).toHaveURL(/\/login$/);
    await expect(b).toHaveURL(/\/login$/);
  });
});
