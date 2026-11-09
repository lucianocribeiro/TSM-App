import { randomInt, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { formatCopy } from "../src/lib/copy/format";
import { copyRecibos } from "../src/lib/copy/recibos";
import { pdfConTexto } from "../tests/pdf-minimo";
import { adminNuevo, registro } from "./datos";
import { loginAs, mainNav } from "./helpers";
import { createE2EUser, fillLegajo, localServiceClient } from "./service";

// F2-04: Carga de recibos, the Admin's flow end to end (create a period,
// upload with the DNI found, a mismatch accepted, a replacement, Rechazar,
// publish, close, re-open), and the Empleado refused like on other Admin
// routes. Invented names and DNIs only. The screen lists every active
// Empleado, so rows are found by the test employee's unique name. Accounts
// that end up with receipts cannot be removed (receipt rows restrict them):
// they stay in the local e2e database, as in the integration fixtures.

const t = copyRecibos;
const BUCKET = "recibos";
const cuentas = registro();
test.afterAll(cuentas.limpiar);

async function empleadoConDni(etiqueta: string) {
  const user = await createE2EUser(`recibos-${etiqueta}`);
  cuentas.add(user.id);
  const sufijo = randomUUID().slice(0, 6);
  const dni = String(randomInt(20_000_000, 45_000_000));
  const nombres = `Prueba ${sufijo}`;
  const apellido = `Recibos ${etiqueta}`;
  await fillLegajo(user.id, { nombres, apellido, dni });
  return { ...user, dni, nombre: `${nombres} ${apellido}` };
}

// A month with no period yet.
async function mesLibre(): Promise<{ anio: number; mes: number }> {
  const service = localServiceClient();
  for (let intento = 0; intento < 50; intento++) {
    const anio = randomInt(2030, 2100);
    const mes = randomInt(1, 13);
    const { data } = await service.from("recibo_periodos").select("id").eq("anio", anio).eq("mes", mes).maybeSingle();
    if (!data) return { anio, mes };
  }
  throw new Error("no free month");
}

const recibo = (dni: string) => ({
  name: "recibo.pdf",
  mimeType: "application/pdf",
  buffer: pdfConTexto(["RECIBO DE HABERES - EMPRESA DE PRUEBA", `DNI ${dni}`]),
});

const fila = (page: Page, nombre: string) => page.getByRole("list", { name: t.tabla.label }).getByRole("listitem", { name: nombre });

async function subirEn(page: Page, nombre: string, dni: string) {
  await fila(page, nombre).locator('input[type="file"]').setInputFiles(recibo(dni));
}

async function crearPeriodo(page: Page) {
  const { anio, mes } = await mesLibre();
  await page.getByRole("button", { name: t.periodos.nuevo }).click();
  const dialogo = page.getByRole("dialog", { name: t.nuevoPeriodo.title });
  await dialogo.getByLabel(t.nuevoPeriodo.mes).selectOption(String(mes));
  await dialogo.getByLabel(t.nuevoPeriodo.anio).fill(String(anio));
  await dialogo.getByRole("button", { name: t.nuevoPeriodo.crear }).click();
  await expect(page).toHaveURL(/\/recibos\?periodo=[0-9a-f-]{36}$/);
  const periodoId = new URL(page.url()).searchParams.get("periodo")!;
  return { periodoId, etiqueta: `${String(mes).padStart(2, "0")}/${anio}` };
}

async function reciboDe(periodoId: string, empleadoId: string) {
  const { data } = await localServiceClient()
    .from("recibos")
    .select("id, archivo_path, estado")
    .eq("periodo_id", periodoId)
    .eq("empleado_id", empleadoId)
    .maybeSingle();
  return data;
}

test("Admin: create a period, upload, accept a DNI mismatch, replace, reject, publish, close and re-open", async ({ page }) => {
  test.setTimeout(120_000);
  const ana = await empleadoConDni("ana");
  const beto = await empleadoConDni("beto");
  await loginAs(page, await adminNuevo("recibos-admin", cuentas.add));
  await mainNav(page).getByRole("link", { name: copy.nav.recibos }).click();
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();

  const { periodoId, etiqueta } = await crearPeriodo(page);
  await expect(page.getByTestId("banner-borrador")).toBeVisible();

  // DNI found: registered with no question.
  await subirEn(page, ana.nombre, ana.dni);
  await expect(fila(page, ana.nombre).getByText(t.fila.cargado)).toBeVisible();
  await expect(fila(page, ana.nombre).getByText(t.estadosFila.cargado, { exact: true })).toBeVisible();
  const primero = await reciboDe(periodoId, ana.id);
  expect(primero).toMatchObject({ estado: "pendiente" });

  // A mismatch: the DNI question, Aceptar, then the replacement question, Reemplazar.
  await subirEn(page, ana.nombre, "11222333");
  const dni = page.getByRole("dialog", { name: t.dialogos.dniNoEncontrado.title });
  await expect(dni.getByText(formatCopy(t.dialogos.dniNoEncontrado.body, { nombre: ana.nombre }))).toBeVisible();
  await dni.getByRole("button", { name: t.dialogos.aceptar }).click();
  const reemplazo = page.getByRole("dialog", { name: t.dialogos.reemplazo.title });
  await expect(reemplazo.getByText(formatCopy(t.dialogos.reemplazo.body, { nombre: ana.nombre, periodo: etiqueta }))).toBeVisible();
  await reemplazo.getByRole("button", { name: t.dialogos.reemplazo.confirmar }).click();
  await expect(fila(page, ana.nombre).getByText(t.fila.cargado)).toBeVisible();
  const segundo = await reciboDe(periodoId, ana.id);
  expect(segundo?.archivo_path).not.toBe(primero?.archivo_path);
  const service = localServiceClient();
  expect((await service.from("recibo_overrides").select("motivo, archivo_path").eq("recibo_id", segundo!.id)).data).toEqual([
    { motivo: "dni_no_encontrado", archivo_path: segundo!.archivo_path },
  ]);
  expect((await service.from("recibo_historial").select("archivo_path").eq("recibo_id", segundo!.id)).data).toEqual([
    { archivo_path: primero!.archivo_path },
  ]);
  // The replaced file stays in storage (decision 4).
  expect((await service.storage.from(BUCKET).download(primero!.archivo_path)).data).not.toBeNull();

  // Rechazar: no receipt, the file is gone.
  await subirEn(page, beto.nombre, "11222333");
  await page.getByRole("dialog", { name: t.dialogos.dniNoEncontrado.title }).getByRole("button", { name: t.dialogos.rechazar }).click();
  await expect(fila(page, beto.nombre).getByText(t.fila.descartado)).toBeVisible();
  expect(await reciboDe(periodoId, beto.id)).toBeNull();
  const { data: objetos } = await service.storage.from(BUCKET).list(`${beto.id}/${periodoId}`);
  expect(objetos ?? []).toEqual([]);

  // Publish, close (rows read-only), re-open.
  const cambiar = async (accion: string, confirmar: string, titulo: string) => {
    await page.getByRole("button", { name: accion, exact: true }).click();
    await page.getByRole("dialog", { name: formatCopy(titulo, { periodo: etiqueta }) }).getByRole("button", { name: confirmar }).click();
  };
  await cambiar(t.acciones.publicar, t.confirmaciones.publicar.confirmar, t.confirmaciones.publicar.title);
  await expect(page.getByText(formatCopy(t.avisos.publicado, { periodo: etiqueta }))).toBeVisible();
  await expect(page.getByTestId("banner-borrador")).toHaveCount(0);

  await cambiar(t.acciones.cerrar, t.confirmaciones.cerrar.confirmar, t.confirmaciones.cerrar.title);
  await expect(page.getByTestId("banner-cerrado")).toBeVisible();
  await expect(fila(page, ana.nombre).getByRole("button", { name: t.fila.reemplazar })).toHaveCount(0);
  await expect(fila(page, beto.nombre).getByRole("button", { name: t.fila.elegir })).toHaveCount(0);
  await expect(fila(page, ana.nombre).getByRole("button", { name: t.fila.ver })).toBeVisible();

  await cambiar(t.acciones.reabrir, t.confirmaciones.reabrir.confirmar, t.confirmaciones.reabrir.title);
  await expect(page.getByTestId("banner-cerrado")).toHaveCount(0);
  await expect(fila(page, beto.nombre).getByRole("button", { name: t.fila.elegir })).toBeVisible();

  const { data: periodo } = await service.from("recibo_periodos").select("estado").eq("id", periodoId).single();
  expect(periodo).toEqual({ estado: "publicado" });
  const { data: historial } = await service.from("recibo_periodo_historial").select("accion").eq("periodo_id", periodoId).order("created_at");
  expect(historial?.map((h) => h.accion)).toEqual(["creado", "publicado", "cerrado", "reabierto"]);
});

test("an Empleado is refused on /recibos like on other Admin routes, and has no Recibos menu item", async ({ page }) => {
  const empleado = await createE2EUser("recibos-empleado");
  cuentas.add(empleado.id);
  await loginAs(page, empleado);
  await expect(mainNav(page).getByRole("link", { name: copy.nav.recibos, exact: true })).toHaveCount(0);
  await page.goto("/recibos");
  await expect(page).toHaveURL(/\/mi-legajo$/);
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toHaveCount(0);
});
