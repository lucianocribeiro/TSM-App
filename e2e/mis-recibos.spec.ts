import { expect, test, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { formatCopy } from "../src/lib/copy/format";
import { copyMisRecibos } from "../src/lib/copy/mis-recibos";
import { adminNuevo, registro } from "./datos";
import { loginAs, mainNav } from "./helpers";
import { reciboPublicado } from "./recibos-datos";
import { createE2EUser, fillLegajo, localServiceClient } from "./service";

// F2-05: Mis Recibos end to end. The Empleado sees the counter, views a
// receipt in a new tab (no download before signing), draws a signature,
// signs, sees Firmado and the counter go down, downloads the signed file and
// changes the signature, while the earlier signed receipt keeps the first
// one. Another employee sees nothing of it; an Admin is refused. Invented
// names only. Accounts that end up with receipts or signatures stay in the
// local e2e database (receipt and signature rows restrict deletion).

const t = copyMisRecibos;
const cuentas = registro();
test.afterAll(cuentas.limpiar);

async function empleado(etiqueta: string) {
  const user = await createE2EUser(`mis-recibos-${etiqueta}`);
  cuentas.add(user.id);
  await fillLegajo(user.id, { nombres: "Prueba", apellido: `Mis Recibos ${etiqueta}` });
  return user;
}

const fila = (page: Page, etiqueta: string) =>
  page.getByRole("list", { name: t.lista.label }).getByRole("listitem", { name: formatCopy(t.lista.periodo, { periodo: etiqueta }) });

// A signature drawn with the mouse: a few strokes across the pad.
async function dibujar(page: Page) {
  const pad = page.getByTestId("signature-pad");
  const caja = (await pad.boundingBox())!;
  for (const fila of [0.35, 0.6]) {
    await page.mouse.move(caja.x + caja.width * 0.1, caja.y + caja.height * fila);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(caja.x + caja.width * (0.1 + i * 0.065), caja.y + caja.height * (fila + (i % 2 ? 0.12 : -0.12)), { steps: 3 });
    }
    await page.mouse.up();
  }
}

async function guardarDibujo(page: Page) {
  const dialogo = page.getByRole("dialog", { name: t.dibujo.title });
  const guardar = dialogo.getByRole("button", { name: t.dibujo.guardar });
  await expect(guardar).toBeDisabled();
  await dibujar(page);
  await expect(guardar).toBeEnabled();
  // F2-05-FIX-01: the exported PNG is transparent but for the strokes.
  const alfa = await page.getByTestId("signature-pad").evaluate(async (lienzo: HTMLCanvasElement) => {
    const blob = await new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, "image/png"));
    const imagen = await createImageBitmap(blob!);
    const copia = new OffscreenCanvas(imagen.width, imagen.height);
    const ctx = copia.getContext("2d")!;
    ctx.drawImage(imagen, 0, 0);
    const datos = ctx.getImageData(0, 0, imagen.width, imagen.height).data;
    let opaco = false;
    for (let i = 3; i < datos.length && !opaco; i += 4) opaco = datos[i] === 255;
    return { esquina: datos[3], opaco };
  });
  expect(alfa).toEqual({ esquina: 0, opaco: true });
  await guardar.click();
  await expect(dialogo).toHaveCount(0);
}

test("Empleado: counter, view in a new tab, draw, sign, download, change the signature", async ({ page }) => {
  test.setTimeout(120_000);
  const ana = await empleado("ana");
  const admin = await adminNuevo("mis-recibos-admin", cuentas.add);
  const primero = await reciboPublicado(ana.id, admin.id);
  const segundo = await reciboPublicado(ana.id, admin.id);

  await loginAs(page, ana);
  const link = mainNav(page).getByRole("link", { name: formatCopy(copy.nav.misRecibosPendientes, { label: copy.nav.misRecibos, n: "2" }) });
  await expect(link).toBeVisible();
  await expect(link.getByTestId("nav-badge")).toHaveText("2");
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();

  // Before signing: Ver opens a new tab; no Descargar.
  const r1 = fila(page, primero.etiqueta);
  await expect(r1.getByText(t.estados.pendiente)).toBeVisible();
  await expect(r1.getByRole("button", { name: t.acciones.descargar })).toHaveCount(0);
  // Headless Chromium has no PDF viewer, so the new tab does not render the
  // file: the test checks the tab opens and requests the inline signed URL
  // (no download parameter).
  const pedido = page.context().waitForEvent("request", (r) => r.url().includes("/object/sign/recibos/"));
  const [pestana] = await Promise.all([page.waitForEvent("popup"), r1.getByRole("button", { name: t.acciones.ver }).click()]);
  expect((await pedido).url()).not.toContain("download=");
  await pestana.close();

  // First signing: the drawing comes first, then the confirmation.
  await r1.getByRole("button", { name: t.acciones.firmar }).click();
  await guardarDibujo(page);
  const confirmar = page.getByRole("dialog", { name: formatCopy(t.firmar.title, { periodo: primero.etiqueta }) });
  await expect(confirmar.getByTestId("declaracion-firma")).toHaveText(t.firmar.declaracion);
  await confirmar.getByRole("button", { name: t.firmar.confirmar }).click();
  await expect(page.getByText(formatCopy(t.firmar.exito, { periodo: primero.etiqueta }))).toBeVisible();
  await expect(r1.getByText(t.estados.firmado, { exact: true })).toBeVisible();
  await expect(mainNav(page).getByRole("link", { name: formatCopy(copy.nav.misRecibosPendiente, { label: copy.nav.misRecibos }) })).toBeVisible();

  // After signing: Descargar gives Recibo-MM-AAAA.pdf.
  const [descarga] = await Promise.all([page.waitForEvent("download"), r1.getByRole("button", { name: t.acciones.descargar }).click()]);
  expect(descarga.suggestedFilename()).toBe(`Recibo-${primero.etiqueta.replace("/", "-")}.pdf`);

  // Change the signature: version 2; the signed receipt keeps version 1.
  const service = localServiceClient();
  const { data: firmado } = await service.from("recibos").select("firma_id, archivo_path").eq("id", primero.id).single();
  await page.getByRole("button", { name: t.miFirma.cambiar }).click();
  await guardarDibujo(page);
  await expect(page.getByText(t.miFirma.guardada)).toBeVisible();
  const { data: versiones } = await service.from("firmas_empleado").select("id, version, activa").eq("empleado_id", ana.id).order("version");
  expect(versiones?.map((v) => [v.version, v.activa])).toEqual([
    [1, false],
    [2, true],
  ]);
  expect(firmado?.firma_id).toBe(versiones![0].id);
  expect((await service.from("recibos").select("firma_id, archivo_path").eq("id", primero.id).single()).data).toEqual(firmado);

  // The second receipt signs with the new signature, no drawing asked.
  const r2 = fila(page, segundo.etiqueta);
  await r2.getByRole("button", { name: t.acciones.firmar }).click();
  await page.getByRole("dialog", { name: formatCopy(t.firmar.title, { periodo: segundo.etiqueta }) }).getByRole("button", { name: t.firmar.confirmar }).click();
  await expect(r2.getByText(t.estados.firmado, { exact: true })).toBeVisible();
  expect((await service.from("recibos").select("firma_id").eq("id", segundo.id).single()).data?.firma_id).toBe(versiones![1].id);
  await expect(mainNav(page).getByRole("link", { name: copy.nav.misRecibos, exact: true })).toBeVisible();
});

test("another employee sees none of it; an Admin is refused on /mis-recibos and has no menu item", async ({ page }) => {
  const ana = await empleado("ana-ajena");
  const beto = await empleado("beto");
  const admin = await adminNuevo("mis-recibos-admin-2", cuentas.add);
  const recibo = await reciboPublicado(ana.id, admin.id);

  await loginAs(page, beto);
  await page.goto("/mis-recibos");
  await expect(page.getByTestId("mis-recibos-vacio")).toBeVisible();
  await expect(page.getByText(formatCopy(t.lista.periodo, { periodo: recibo.etiqueta }))).toHaveCount(0);
  await page.getByRole("button", { name: copy.auth.logout }).click();
  await expect(page).toHaveURL(/\/login$/);

  await loginAs(page, admin);
  await expect(mainNav(page).getByRole("link", { name: copy.nav.misRecibos })).toHaveCount(0);
  await page.goto("/mis-recibos");
  await expect(page).toHaveURL(/\/mi-legajo$/);
});
