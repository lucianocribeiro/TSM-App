import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { formatCopy } from "../src/lib/copy/format";
import { copyRecibos } from "../src/lib/copy/recibos";
import { adminNuevo, registro } from "./datos";
import { loginAs } from "./helpers";
import { archivoReemplazado, firmadoConServicio, periodoPublicado, reciboEnPeriodo } from "./recibos-datos";
import { screenshotBoth } from "./screens";
import { createE2EUser, fillLegajo, localServiceClient } from "./service";

// F2-06: Estado de firmas end to end, as an Admin: the states of a seeded
// period (a pending receipt with a replaced file, a signed one, an employee
// without one), the counts, the filters, the detail with the signature
// evidence and the history, and the files Ver and Descargar ask for. An
// Empleado reaches none of it. Invented names only; accounts that end up
// with receipts stay in the local e2e database (rows restrict deletion).

const t = copyRecibos.estado;
const cuentas = registro();
test.afterAll(cuentas.limpiar);

const marca = () => randomUUID().slice(0, 6);

async function empleado(etiqueta: string, nombres: string, apellido: string) {
  const user = await createE2EUser(`estado-${etiqueta}`);
  cuentas.add(user.id);
  await fillLegajo(user.id, { nombres, apellido });
  return { ...user, nombre: `${nombres} ${apellido}` };
}

const lista = (page: Page) => page.getByRole("list", { name: t.tabla.label });
const fila = (page: Page, nombre: string) => lista(page).getByRole("listitem", { name: nombre, exact: true });

test("Admin: states, counts, filters, the detail with evidence and history, and the files it serves", async ({ page }) => {
  test.setTimeout(120_000);
  const m = marca();
  const admin = await adminNuevo("estado-admin", cuentas.add);
  await fillLegajo(admin.id, { nombres: "Admin", apellido: `Estado ${m}` });
  const ana = await empleado("ana", `Ana ${m}`, "Núñez Estado");
  const beto = await empleado("beto", `Beto ${m}`, "Firmante");
  const caro = await empleado("caro", `Caro ${m}`, "Sin Recibo");
  const periodo = await periodoPublicado(admin.id);
  const etiqueta = `${String(periodo.mes).padStart(2, "0")}/${periodo.anio}`;
  const mmaaaa = etiqueta.replace("/", "-");
  const reciboAna = await reciboEnPeriodo(periodo, ana.id, admin.id);
  await archivoReemplazado({ id: reciboAna.id, periodoId: periodo.id }, ana.id, admin.id);
  const reciboBeto = await reciboEnPeriodo(periodo, beto.id, admin.id);
  await firmadoConServicio(reciboBeto.id, beto.id);

  await loginAs(page, admin);
  await page.goto(`/recibos?periodo=${periodo.id}`);
  // The second view of /recibos, on the same period.
  const vistas = page.getByRole("navigation", { name: copyRecibos.vistas.label });
  await vistas.getByRole("link", { name: copyRecibos.vistas.estado }).click();
  await expect(page).toHaveURL(new RegExp(`/recibos/estado\\?periodo=${periodo.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
  await expect(vistas.getByRole("link", { name: copyRecibos.vistas.estado })).toHaveAttribute("aria-current", "page");

  // States, the signed time and the counts.
  await expect(fila(page, ana.nombre)).toHaveAttribute("data-estado", "pendiente");
  await expect(fila(page, ana.nombre).getByText(t.estados.pendiente, { exact: true })).toBeVisible();
  await expect(fila(page, beto.nombre)).toHaveAttribute("data-estado", "firmado");
  await expect(fila(page, beto.nombre).getByTestId("firmado-at")).toHaveText(/^Firmado el \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  await expect(fila(page, caro.nombre)).toHaveAttribute("data-estado", "sin_recibo");
  await expect(fila(page, caro.nombre).getByRole("link")).toHaveCount(0);
  await expect(page.getByTestId("conteo-estado")).toContainText(/^Firmados: 1 · Pendientes: 1 · Sin recibo: \d+$/);
  await expect(page.getByTestId("banner-borrador-estado")).toHaveCount(0);

  // The frozen header covers neither the filters nor the first row.
  const bajoEncabezado = async (locator: Locator) => {
    const encabezado = (await page.getByTestId("page-header").boundingBox())!;
    expect((await locator.boundingBox())!.y).toBeGreaterThanOrEqual(encabezado.y + encabezado.height);
  };
  const filtros = page.getByRole("group", { name: t.filtros.label });
  await bajoEncabezado(filtros);
  await bajoEncabezado(lista(page).getByRole("listitem").first());

  // Filters.
  await filtros.getByRole("button", { name: t.filtros.opciones.firmado }).click();
  await expect(lista(page).getByRole("listitem")).toHaveCount(1);
  await expect(fila(page, beto.nombre)).toBeVisible();
  await filtros.getByRole("button", { name: t.filtros.opciones.pendiente }).click();
  await expect(lista(page).getByRole("listitem")).toHaveCount(1);
  await expect(fila(page, ana.nombre)).toBeVisible();
  await filtros.getByRole("button", { name: t.filtros.opciones.sin_recibo }).click();
  await expect(fila(page, caro.nombre)).toBeVisible();
  await expect(fila(page, ana.nombre)).toHaveCount(0);
  await filtros.getByRole("button", { name: t.filtros.opciones.todos }).click();
  await expect(fila(page, ana.nombre)).toBeVisible();

  // Detalle of the signed receipt: evidence and the signature image.
  await fila(page, beto.nombre).getByRole("link", { name: formatCopy(t.detalleDe, { nombre: beto.nombre }) }).click();
  const detalleBeto = page.getByRole("dialog", { name: formatCopy(t.dialogo.title, { nombre: beto.nombre, periodo: etiqueta }) });
  await expect(detalleBeto).toBeVisible();
  await expect(detalleBeto.getByTestId("detalle-firma")).toContainText(formatCopy(t.dialogo.firma.versionValor, { version: "1" }));
  await expect(detalleBeto.getByTestId("detalle-firma-imagen")).toBeVisible();
  await expect(detalleBeto.getByTestId("detalle-dni")).toContainText(t.dialogo.dni.vacio);
  await expect(detalleBeto.getByTestId("detalle-reemplazos")).toContainText(t.dialogo.reemplazos.vacio);
  await screenshotBoth(page, "recibos-estado-detalle-firmado");
  await detalleBeto.getByRole("button", { name: t.dialogo.cerrar }).click();
  await expect(detalleBeto).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/recibos/estado\\?periodo=${periodo.id}$`));

  // Detalle of the pending receipt: no signature yet, one replaced file.
  await fila(page, ana.nombre).getByRole("link", { name: formatCopy(t.detalleDe, { nombre: ana.nombre }) }).click();
  const detalleAna = page.getByRole("dialog", { name: formatCopy(t.dialogo.title, { nombre: ana.nombre, periodo: etiqueta }) });
  await expect(detalleAna.getByTestId("detalle-firma")).toContainText(t.dialogo.firma.sinFirma);
  await expect(detalleAna.getByTestId("detalle-actual")).toContainText(`Admin Estado ${m}`);
  const reemplazo = detalleAna.getByRole("listitem", { name: formatCopy(t.dialogo.reemplazos.item, { n: "1" }) });
  await expect(reemplazo).toContainText(t.dialogo.reemplazos.estados.pendiente);
  await expect(reemplazo).toContainText(`Admin Estado ${m}`);

  // Ver opens the current file inline in a new tab; Descargar names it.
  const pedido = page.context().waitForEvent("request", (r) => r.url().includes("/object/sign/recibos/"));
  const [pestana] = await Promise.all([
    page.waitForEvent("popup"),
    detalleAna.getByTestId("archivo-actual").getByRole("button", { name: t.dialogo.ver }).click(),
  ]);
  const url = (await pedido).url();
  expect(decodeURIComponent(url)).toContain(reciboAna.path);
  expect(url).not.toContain("download=");
  await pestana.close();
  const [actual] = await Promise.all([
    page.waitForEvent("download"),
    detalleAna.getByTestId("archivo-actual").getByRole("button", { name: t.dialogo.descargar }).click(),
  ]);
  expect(actual.suggestedFilename()).toBe(`Recibo-Nunez-Estado-${mmaaaa}.pdf`);
  const [anterior] = await Promise.all([
    page.waitForEvent("download"),
    reemplazo.getByRole("button", { name: t.dialogo.descargar }).click(),
  ]);
  expect(anterior.suggestedFilename()).toBe(`Recibo-Nunez-Estado-${mmaaaa}-reemplazado-1.pdf`);

  // Keyboard: Escape closes the detail.
  await page.keyboard.press("Escape");
  await expect(detalleAna).toHaveCount(0);
});

test("a draft period shows the banner", async ({ page }) => {
  const admin = await adminNuevo("estado-borrador", cuentas.add);
  const service = localServiceClient();
  let periodoId = "";
  for (let intento = 0; intento < 50 && !periodoId; intento++) {
    const { data } = await service
      .from("recibo_periodos")
      .insert({ anio: 2030 + Math.floor(Math.random() * 70), mes: 1 + Math.floor(Math.random() * 12), created_by: admin.id })
      .select("id")
      .single();
    periodoId = data?.id ?? "";
  }
  expect(periodoId).not.toBe("");
  await loginAs(page, admin);
  await page.goto(`/recibos/estado?periodo=${periodoId}`);
  await expect(page.getByTestId("banner-borrador-estado")).toHaveText(t.banners.borrador);
  await service.from("recibo_periodos").delete().eq("id", periodoId);
});

test("an Empleado cannot reach Estado de firmas, like other Admin routes, and never sees the card", async ({ page }) => {
  const user = await createE2EUser("estado-empleado");
  cuentas.add(user.id);
  await loginAs(page, user);
  await page.goto("/recibos/estado");
  await expect(page).toHaveURL(/\/mi-legajo$/);
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toHaveCount(0);
  await page.goto("/legajos");
  await expect(page).toHaveURL(/\/mi-legajo$/);
  await expect(page.locator("[data-kpi]")).toHaveCount(0);
  await expect(page.getByText(copy.legajos.kpi.recibosSinFirmar)).toHaveCount(0);
});
