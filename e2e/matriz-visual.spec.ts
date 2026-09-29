import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { THEME_COOKIE, type Theme } from "../src/lib/theme/theme";
import { adminNuevo, empleadoCompleto, registro, solicitudPendiente } from "./datos";
import { fillLogin, loginAs } from "./helpers";
import { assertNoSecretOnPage } from "./secrets";
import { createE2EUser, localServiceClient } from "./service";

// F1-11B, GAP-08 (partial): the main screens in light and dark, at desktop
// (1280px) and mobile (390px) widths. Screenshots go to VISUAL_DIR, uploaded
// by CI as the e2e-visual-matrix artifact for review; no pixel comparison.
// What passes or fails here, for every combination:
// - the theme asked for (theme cookie, rendered by the server) is the one
//   applied: data-theme on <html>, the --bg token and the body background;
// - at 390px the page does not scroll sideways;
// - the browser logs no console error and no page error.

const VISUAL_DIR = "test-results/visual-matrix";
const ANCHOS = [
  { ancho: 1280, alto: 800 },
  { ancho: 390, alto: 844 },
] as const;
const TEMAS: Theme[] = ["light", "dark"];
// The --bg token of src/app/globals.css and its computed body background.
const FONDO: Record<Theme, { token: string; body: string }> = {
  light: { token: "#f3f2f2", body: "rgb(243, 242, 242)" },
  dark: { token: "#00072e", body: "rgb(0, 7, 46)" },
};

const cuentas = registro();
test.afterAll(cuentas.limpiar);

function baseURL(): string {
  const url = test.info().project.use.baseURL;
  if (!url) throw new Error("baseURL is required");
  return url;
}

function registrarErrores(page: Page, errores: string[]) {
  page.on("console", (message) => {
    if (message.type() === "error") errores.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errores.push(`page: ${error.message}`));
}

async function comprobarYCapturar(page: Page, nombre: string, ancho: number, tema: Theme) {
  const combinacion = `${nombre} ${ancho}px ${tema}`;
  await expect(page.locator("html"), combinacion).toHaveAttribute("data-theme", tema);
  const aplicado = await page.evaluate(() => ({
    token: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim().toLowerCase(),
    body: getComputedStyle(document.body).backgroundColor,
  }));
  expect(aplicado, combinacion).toEqual(FONDO[tema]);
  if (ancho === 390) {
    const scroll = await page.evaluate(() => {
      const client = document.documentElement.clientWidth;
      // On failure, name the innermost elements that stick out of the page
      // and are not inside a horizontally scrolling or clipping box.
      const culpables: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.right <= client + 1) continue;
        let recortado = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (getComputedStyle(p).overflowX !== "visible") recortado = true;
        }
        if (recortado) continue;
        if (Array.from(el.children).some((hijo) => hijo.getBoundingClientRect().right > client + 1)) continue;
        const id = el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : "";
        culpables.push(`<${el.tagName.toLowerCase()}${id} class="${el.className}"> right=${Math.round(rect.right)}`);
      }
      return { scroll: document.documentElement.scrollWidth, client, culpables: culpables.slice(0, 6) };
    });
    expect(scroll.scroll, `${combinacion}: horizontal scroll; ${scroll.culpables.join(" | ")}`).toBeLessThanOrEqual(scroll.client);
  }
  await assertNoSecretOnPage(page);
  await page.addStyleTag({ content: "*, *::before, *::after, *::backdrop { transition: none !important; }" });
  await page.screenshot({ path: `${VISUAL_DIR}/${nombre}-${ancho}-${tema}.png`, fullPage: true });
}

// Screens reached once, then reloaded for every width and theme.
type Pantalla = { nombre: string; abrir: (page: Page) => Promise<void>; lista: (page: Page) => Locator };

const PANTALLAS: Pantalla[] = [
  {
    nombre: "login",
    abrir: async (page) => {
      await page.goto("/login");
    },
    lista: (page) => page.getByRole("heading", { level: 1, name: copy.auth.login.title }),
  },
  {
    nombre: "cambiar-password",
    abrir: async (page) => {
      const user = await createE2EUser("visual-forzado");
      cuentas.add(user.id);
      expect((await localServiceClient().from("profiles").update({ debe_cambiar_password: true }).eq("id", user.id)).error).toBeNull();
      await fillLogin(page, user.email, user.password);
      await expect(page).toHaveURL(/\/cambiar-password$/);
    },
    lista: (page) => page.getByRole("heading", { level: 1, name: copy.password.title }),
  },
  {
    nombre: "mi-legajo-con-datos",
    abrir: async (page) => loginAs(page, await empleadoCompleto("visual-mi-legajo", cuentas.add)),
    lista: (page) => page.getByTestId("grupo-A"),
  },
  {
    nombre: "mi-legajo-vacio",
    abrir: async (page) => {
      const user = await createE2EUser("visual-vacio");
      cuentas.add(user.id);
      await loginAs(page, user);
    },
    lista: (page) => page.getByText(copy.miLegajo.vacio.title, { exact: true }),
  },
  {
    nombre: "legajos",
    abrir: async (page) => {
      await loginAs(page, await adminNuevo("visual-legajos", cuentas.add));
      await page.goto("/legajos");
    },
    lista: (page) => page.getByRole("heading", { level: 1, name: copy.legajos.title }),
  },
  {
    nombre: "legajo-detalle",
    abrir: async (page) => {
      const emp = await empleadoCompleto("visual-detalle", cuentas.add);
      await loginAs(page, await adminNuevo("visual-detalle-admin", cuentas.add));
      await page.goto(`/legajos/${emp.id}`);
    },
    lista: (page) => page.getByTestId("grupo-E"),
  },
  {
    nombre: "aprobaciones",
    abrir: async (page) => {
      await loginAs(page, await adminNuevo("visual-aprobaciones", cuentas.add));
      await page.goto("/aprobaciones");
    },
    lista: (page) => page.getByRole("heading", { level: 1, name: copy.aprobaciones.bandeja.title }),
  },
  {
    nombre: "solicitud-detalle",
    abrir: async (page) => {
      const emp = await empleadoCompleto("visual-solicitud", cuentas.add);
      const solicitud = await solicitudPendiente(emp, [
        { campo: "telefono_celular", valor_propuesto: "11 7777-8888" },
        { campo: "alergias", valor_propuesto: "Polen" },
      ]);
      await loginAs(page, await adminNuevo("visual-solicitud-admin", cuentas.add));
      await page.goto(`/aprobaciones/solicitudes/${solicitud.id}`);
    },
    lista: (page) => page.getByTestId("decision"),
  },
  {
    nombre: "usuarios",
    abrir: async (page) => {
      await loginAs(page, await adminNuevo("visual-usuarios", cuentas.add));
      await page.goto("/usuarios");
    },
    lista: (page) => page.getByRole("heading", { level: 1, name: copy.usuarios.title }),
  },
];

for (const pantalla of PANTALLAS) {
  test(`visual matrix: ${pantalla.nombre}`, async ({ page }) => {
    const errores: string[] = [];
    registrarErrores(page, errores);
    await pantalla.abrir(page);
    for (const { ancho, alto } of ANCHOS) {
      await page.setViewportSize({ width: ancho, height: alto });
      for (const tema of TEMAS) {
        await page.context().addCookies([{ name: THEME_COOKIE, value: tema, url: baseURL() }]);
        await page.reload();
        await expect(pantalla.lista(page)).toBeVisible();
        await comprobarYCapturar(page, pantalla.nombre, ancho, tema);
      }
    }
    expect(errores).toEqual([]);
  });
}

// The inactivity warning depends on the page clock, which a reload would
// restart: each combination gets its own browser context and sign-in.
test("visual matrix: aviso-inactividad", async ({ browser }: { browser: Browser }) => {
  const user = await empleadoCompleto("visual-inactividad", cuentas.add);
  const errores: string[] = [];
  for (const { ancho, alto } of ANCHOS) {
    for (const tema of TEMAS) {
      const context = await browser.newContext({ baseURL: baseURL(), viewport: { width: ancho, height: alto } });
      await context.addCookies([{ name: THEME_COOKIE, value: tema, url: baseURL() }]);
      const page = await context.newPage();
      registrarErrores(page, errores);
      await page.clock.install();
      await loginAs(page, user);
      await page.clock.fastForward("13:00");
      await expect(page.getByRole("dialog", { name: copy.sesion.avisoTitulo })).toBeVisible();
      await comprobarYCapturar(page, "aviso-inactividad", ancho, tema);
      await context.close();
    }
  }
  expect(errores).toEqual([]);
});
