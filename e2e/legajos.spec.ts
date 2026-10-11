import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { copyLaborales } from "../src/lib/copy/laborales";
import { formatCopy } from "../src/lib/copy/format";
import { cuilDigitoVerificador } from "../src/lib/legajo/cuil";
import { loginAs, mainNav } from "./helpers";
import { screenshotBoth } from "./screens";
import { createE2EUser, deleteE2EUser, fillLaboral, fillLegajo, itemIdE2E, localServiceClient, seedAdminClient } from "./service";

// F1-09A: Legajos (Admin): list, detail, direct editing and documents (PRD
// US-4, US-8). Each test uses its own throwaway accounts, told apart from any
// other data by its own Área (a Configuración item, CR-2, with one Puesto,
// "Técnico"). The items are removed after the accounts.

const t = copy.legajos;
const ml = copy.miLegajo;
const campos = copy.aprobaciones.campos;
const created: string[] = [];
const MARCA = `E2E ${randomUUID().slice(0, 6)}`;
// In deletion order: a Puesto before its Área.
const items: string[] = [];

test.afterAll(async () => {
  for (const id of created) await deleteE2EUser(id);
  for (const id of items) await localServiceClient().from("catalogo_items").delete().eq("id", id);
});

// A new list item, written with the service role (no history).
async function nuevoItem(lista: "area" | "puesto" | "sucursal" | "tarea", nombre: string, areaId: string | null = null) {
  const { data, error } = await localServiceClient().from("catalogo_items").insert({ lista, nombre, area_id: areaId }).select("id").single();
  if (error || !data) throw new Error(`item setup failed: ${error?.message}`);
  items.unshift(data.id);
  return data.id;
}

// A new Área with its Puesto "Técnico"; its name.
async function nuevaArea(): Promise<string> {
  const nombre = `Área ${MARCA} ${randomUUID().slice(0, 6)}`;
  await nuevoItem("puesto", "Técnico", await nuevoItem("area", nombre));
  return nombre;
}

// A required field's label in the group E form.
const obligatorio = (campo: keyof typeof copyLaborales.campos) => formatCopy(copyLaborales.form.obligatorio, { campo: copyLaborales.campos[campo] });

// A valid CUIL for a DNI (prefix 20, or 23 when 20 has no check digit).
function cuilPara(dni: string): string {
  for (const prefijo of ["20", "23"]) {
    const digito = cuilDigitoVerificador(`${prefijo}${dni}`);
    if (digito !== null) return `${prefijo}-${dni}-${digito}`;
  }
  throw new Error("no CUIL");
}

async function empleado(
  label: string,
  area: string,
  extra: { nombres: string; apellido: string; dni: string; sucursal?: string; tarea?: string; fechaIngreso?: string },
) {
  const suffix = randomUUID().slice(0, 8);
  const user = await createE2EUser(`${label}-${suffix}`);
  created.push(user.id);
  const cuil = cuilPara(extra.dni);
  await fillLegajo(user.id, {
    nombres: extra.nombres,
    apellido: extra.apellido,
    dni: extra.dni,
    nacionalidad: "Argentina",
    cuil,
    fecha_nacimiento: "1990-01-01",
    calle_altura: "Calle Falsa 123",
    localidad: "Localidad de Prueba",
    partido: "Tigre",
    telefono_celular: "11 4444-5555",
    email_personal: "e2e.personal@example.test",
    estado_civil: "soltero",
    tiene_hijos: false,
  });
  await fillLaboral(user.id, {
    numero_legajo: `L-${suffix}`,
    area,
    puesto: "Técnico",
    fecha_ingreso: extra.fechaIngreso ?? "2020-01-15",
    sucursal: extra.sucursal ?? "Casa Central",
    tarea: extra.tarea ?? "Administrativo",
  });
  return { ...user, cuil, numeroLegajo: `L-${suffix}` };
}

async function admin() {
  const user = await createE2EUser(`legajos-admin-${randomUUID().slice(0, 8)}`, "admin");
  created.push(user.id);
  return user;
}

const filas = (page: Page) => page.getByTestId("legajo-row");
const kpi = (page: Page, key: string) => page.locator(`[data-kpi="${key}"] dd`);

// The expected card values, straight from the database: accounts not
// deactivated with estado laboral Activo or En prueba, and those of them with
// fecha de ingreso in the current month in Argentina.
async function kpisEsperados() {
  const mes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit" }).format(new Date());
  const { data, error } = await localServiceClient()
    .from("legajos")
    .select("legajos_laborales(fecha_ingreso, estado_laboral), profiles!inner(estado_cuenta)");
  if (error) throw new Error(`kpi setup failed: ${error.message}`);
  const activos = (data ?? []).filter(
    (fila) =>
      fila.profiles.estado_cuenta === "activa" &&
      (fila.legajos_laborales?.estado_laboral === "activo" || fila.legajos_laborales?.estado_laboral === "en_prueba"),
  );
  return {
    mes,
    activos: activos.length,
    ingresosDelMes: activos.filter((fila) => fila.legajos_laborales?.fecha_ingreso?.slice(0, 7) === mes).length,
  };
}
const grupo = (page: Page, id: string) => page.getByTestId(`grupo-${id}`);
const dato = (page: Page, id: string, campo: string) => grupo(page, id).locator(`[data-campo="${campo}"]`);

test("the Admin filters, searches and shows deactivated employees in the list", async ({ page }) => {
  const area = await nuevaArea();
  const ana = await empleado("lista-ana", area, { nombres: "Ana", apellido: "Aguirre", dni: "95100001" });
  const beto = await empleado("lista-beto", area, { nombres: "Beto", apellido: "Benítez", dni: "95100002", sucursal: "Pacheco", tarea: "Cajero" });
  const baja = await empleado("lista-baja", area, { nombres: "Carla", apellido: "Castro", dni: "95100003" });
  const seedAdmin = await seedAdminClient();
  const desactivada = await seedAdmin.rpc("desactivar_cuenta", { p_profile_id: baja.id, p_motivo: "Prueba e2e" });
  expect(desactivada.error).toBeNull();

  await loginAs(page, await admin());
  await mainNav(page).getByRole("link", { name: copy.nav.legajos }).click();
  await expect(page).toHaveURL(/\/legajos$/);
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();

  // Área filter (options from Configuración): only this test's employees;
  // the deactivated one hidden.
  await page.getByLabel(copyLaborales.listado.filtros.area, { exact: true }).selectOption({ label: area });
  await expect(filas(page)).toHaveCount(2);
  await expect(filas(page).nth(0)).toContainText("Ana Aguirre");
  await expect(filas(page).nth(1)).toContainText("Beto Benítez");
  await expect(filas(page).nth(0)).toContainText(formatCopy(copyLaborales.listado.numeroLegajo, { numero: ana.numeroLegajo }));
  await screenshotBoth(page, "legajos-lista");

  // The Sucursal and Tarea columns and filters; no bruto anywhere.
  await expect(page.getByRole("columnheader", { name: copyLaborales.listado.columnas.sucursal })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: copyLaborales.listado.columnas.tarea })).toBeVisible();
  await expect(filas(page).nth(1)).toContainText("Pacheco");
  await expect(filas(page).nth(1)).toContainText("Cajero");
  await page.getByLabel(copyLaborales.listado.filtros.sucursal, { exact: true }).selectOption({ label: "Pacheco" });
  await expect(filas(page)).toHaveCount(1);
  await expect(filas(page)).toContainText("Beto Benítez");
  await page.getByLabel(copyLaborales.listado.filtros.sucursal, { exact: true }).selectOption("");
  await page.getByLabel(copyLaborales.listado.filtros.tarea, { exact: true }).selectOption({ label: "Cajero" });
  await expect(filas(page)).toHaveCount(1);
  await expect(filas(page)).toContainText("Beto Benítez");
  await page.getByLabel(copyLaborales.listado.filtros.tarea, { exact: true }).selectOption("");
  await page.getByLabel(copyLaborales.listado.filtros.estadoLaboral, { exact: true }).selectOption("en_prueba");
  await expect(page.getByText(t.sinResultados)).toBeVisible();
  await page.getByLabel(copyLaborales.listado.filtros.estadoLaboral, { exact: true }).selectOption("");

  // Search: CUIL without hyphens, CUIL with hyphens, DNI, name, número de legajo.
  const buscar = page.getByLabel(t.busqueda.label, { exact: true });
  for (const term of [beto.cuil.replace(/-/g, ""), beto.cuil, "95100002", "benitez", beto.numeroLegajo]) {
    await buscar.fill(term);
    await expect(filas(page), term).toHaveCount(1);
    await expect(filas(page), term).toContainText("Beto Benítez");
  }

  // Deactivated employees only with the toggle, marked as such.
  await buscar.fill("castro");
  await expect(page.getByText(t.sinResultados)).toBeVisible();
  await page.getByLabel(t.filtros.mostrarBajas, { exact: true }).check();
  await expect(filas(page)).toHaveCount(1);
  await expect(filas(page)).toHaveAttribute("data-baja", "true");
  await expect(filas(page)).toContainText(t.dadoDeBaja);
  await buscar.fill("");
  await expect(filas(page)).toHaveCount(3);
  await screenshotBoth(page, "legajos-lista-bajas");

  await page.getByRole("button", { name: t.filtros.limpiar }).click();
  await expect(page.getByLabel(copyLaborales.listado.filtros.area, { exact: true })).toHaveValue("");
  await expect(page.getByLabel(t.filtros.mostrarBajas, { exact: true })).not.toBeChecked();
});

test("the KPI cards show Activos and Ingresos del mes for the whole workforce, and nothing else", async ({ page }) => {
  // One active employee who joined this month (Argentina), so the count is not trivially zero.
  const { mes } = await kpisEsperados();
  const area = await nuevaArea();
  await empleado("kpi", area, { nombres: "Gala", apellido: "Gómez", dni: "95100007", fechaIngreso: `${mes}-01` });

  await loginAs(page, await admin());
  await page.goto("/legajos");
  await expect(page.getByText(t.kpis.activos, { exact: true })).toBeVisible();
  await expect(page.getByText(t.kpis.ingresosDelMes, { exact: true })).toBeVisible();
  await expect(page.locator("[data-kpi]")).toHaveCount(2);
  for (const ausente of ["En licencia", "Recibos sin firmar"]) {
    await expect(page.getByText(ausente, { exact: false })).toHaveCount(0);
  }

  // Other tests add and remove accounts in parallel: compare against a fresh
  // count on each attempt.
  let esperado = { activos: 0, ingresosDelMes: 0 };
  await expect(async () => {
    esperado = await kpisEsperados();
    await page.reload();
    await expect(kpi(page, "activos")).toHaveText(String(esperado.activos), { timeout: 2_000 });
    await expect(kpi(page, "ingresos-del-mes")).toHaveText(String(esperado.ingresosDelMes), { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  expect(esperado.ingresosDelMes).toBeGreaterThanOrEqual(1);
  await screenshotBoth(page, "legajos-kpis");

  // Filters, search and the deactivated toggle leave the cards as they are.
  const antes = { activos: await kpi(page, "activos").textContent(), ingresos: await kpi(page, "ingresos-del-mes").textContent() };
  await page.getByLabel(copyLaborales.listado.filtros.area, { exact: true }).selectOption({ label: area });
  await page.getByLabel(t.busqueda.label, { exact: true }).fill("gomez");
  await page.getByLabel(t.filtros.mostrarBajas, { exact: true }).check();
  await expect(filas(page)).toHaveCount(1);
  await expect(kpi(page, "activos")).toHaveText(antes.activos ?? "");
  await expect(kpi(page, "ingresos-del-mes")).toHaveText(antes.ingresos ?? "");
});

test("the Admin opens a legajo, edits groups E and A directly, and uploads and downloads a document", async ({ page }) => {
  const area = await nuevaArea();
  // A Sucursal the legajo has, deactivated afterwards: kept and marked.
  const vieja = `Sucursal ${MARCA} ${randomUUID().slice(0, 6)}`;
  const viejaId = await nuevoItem("sucursal", vieja);
  const emp = await empleado("detalle", area, { nombres: "Diego", apellido: "Duarte", dni: "95100004", sucursal: vieja });
  expect((await localServiceClient().from("catalogo_items").update({ activo: false }).eq("id", viejaId)).error).toBeNull();
  const adminUser = await admin();
  await loginAs(page, adminUser);
  await page.goto("/legajos");
  await page.getByLabel(copyLaborales.listado.filtros.area, { exact: true }).selectOption({ label: area });
  await filas(page).first().click();
  await expect(page).toHaveURL(new RegExp(`/legajos/${emp.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Diego Duarte" })).toBeVisible();
  await expect(page.getByText(t.detalle.nota)).toBeVisible();

  // Group E (CR-2): dropdowns of Configuración, the inactive Sucursal kept
  // and marked, no bruto mensual or modalidad.
  const inactiva = formatCopy(copyLaborales.form.inactivo, { nombre: vieja });
  const e = grupo(page, "E");
  await expect(dato(page, "E", "sucursal")).toContainText(inactiva);
  await expect(dato(page, "E", "area")).toContainText(area);
  await expect(e.locator('[data-campo="bruto_mensual"], [data-campo="modalidad"]')).toHaveCount(0);
  await e.getByRole("button", { name: ml.editar }).click();
  const sucursal = e.getByLabel(obligatorio("sucursal"), { exact: true });
  await expect(sucursal).toHaveValue(viejaId);
  await expect(sucursal.locator("option:checked")).toHaveText(inactiva);
  const puesto = e.getByLabel(obligatorio("puesto"), { exact: true });
  await expect(puesto.locator("option:checked")).toHaveText("Técnico");

  // A new Área clears the Puesto and offers only its Puestos.
  await e.getByLabel(obligatorio("area"), { exact: true }).selectOption({ label: "Logística" });
  await expect(puesto).toHaveValue("");
  await expect(puesto.locator("option")).toHaveText([ml.elegir, "Depósito", "Distribución"]);
  await e.getByRole("button", { name: ml.guardar }).click();
  await expect(e.getByText(copy.legajo.validation.required)).toBeVisible();
  await expect(e.getByText(ml.errors.revisarCampos)).toBeVisible();
  await screenshotBoth(page, "legajos-detalle-laborales");
  await puesto.selectOption({ label: "Depósito" });
  await e.getByRole("button", { name: ml.guardar }).click();
  await expect(page.getByRole("status").filter({ hasText: ml.exito.guardado })).toBeVisible();
  await expect(dato(page, "E", "area")).toContainText("Logística");
  await expect(dato(page, "E", "puesto")).toContainText("Depósito");
  await expect(dato(page, "E", "sucursal")).toContainText(inactiva);

  // Group A, validated with the shared rules first.
  await grupo(page, "A").getByRole("button", { name: ml.editar }).click();
  await grupo(page, "A").getByLabel(campos.cuil, { exact: true }).fill("30-95100004-1");
  await grupo(page, "A").getByRole("button", { name: ml.guardar }).click();
  await expect(grupo(page, "A").getByText(copy.legajo.validation.cuilPrefijo)).toBeVisible();
  await grupo(page, "A").getByLabel(campos.cuil, { exact: true }).fill(emp.cuil);
  await grupo(page, "A").getByLabel(campos.nombres, { exact: true }).fill("Diego Martín");
  await grupo(page, "A").getByRole("button", { name: ml.guardar }).click();
  await expect(dato(page, "A", "nombres")).toContainText("Diego Martín");

  // A document, approved at once, then downloaded.
  const fila = page.getByTestId("documento-dni_frente");
  const input = page.getByLabel(formatCopy(ml.documentos.archivoLabel, { documento: copy.documentos.tipos.dni_frente }), { exact: true });
  await input.setInputFiles({ name: "dni-admin.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% FAKE TEST FILE - admin e2e\n%%EOF\n") });
  await expect(page.getByRole("status").filter({ hasText: ml.documentos.exito.subidoAdmin })).toBeVisible();
  await expect(fila).toContainText(ml.documentos.estados.aprobado);
  await screenshotBoth(page, "legajos-detalle");

  const downloadPromise = page.waitForEvent("download");
  await fila.getByRole("button", { name: ml.documentos.descargar }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("dni-admin.pdf");
  expect(readFileSync(await download.path(), "utf8")).toContain("FAKE TEST FILE - admin e2e");
  await expect(page).toHaveURL(new RegExp(`/legajos/${emp.id}$`));

  // Stored directly: no change request; the document is approved by the Admin.
  const service = localServiceClient();
  const { data: legajo } = await service.from("legajos").select("id, nombres, legajos_laborales(area_id, puesto_id, sucursal_id)").eq("profile_id", emp.id).single();
  expect(legajo).toMatchObject({
    nombres: "Diego Martín",
    legajos_laborales: {
      area_id: await itemIdE2E("area", "Logística"),
      puesto_id: await itemIdE2E("puesto", "Depósito", "Logística"),
      sucursal_id: viejaId,
    },
  });
  const { count } = await service.from("solicitudes_cambio").select("id", { count: "exact", head: true }).eq("legajo_id", legajo!.id);
  expect(count).toBe(0);
  const { data: doc } = await service.from("legajo_documentos").select("estado, uploaded_by").eq("legajo_id", legajo!.id).single();
  expect(doc).toEqual({ estado: "aprobado", uploaded_by: adminUser.id });

  // Delete the current document.
  await fila.getByRole("button", { name: ml.documentos.eliminar }).click();
  const dialog = page.getByRole("dialog", { name: ml.documentos.eliminarTitle });
  await expect(dialog).toContainText(t.documentos.eliminarVigenteBody);
  await dialog.getByRole("button", { name: ml.documentos.eliminar }).click();
  await expect(fila).toContainText(ml.documentos.estados.faltante);

  // Configuración offers Eliminar only for an item no legajo uses.
  const libre = `Sucursal ${MARCA} ${randomUUID().slice(0, 6)}`;
  await nuevoItem("sucursal", libre);
  await page.goto("/configuracion?lista=sucursal");
  const item = (nombre: string) => page.getByTestId("catalogo-item").filter({ has: page.getByText(nombre, { exact: true }) });
  await expect(item(vieja)).toBeVisible();
  await expect(item(vieja).getByRole("button", { name: copy.configuracion.acciones.eliminar })).toHaveCount(0);
  await expect(item(libre).getByRole("button", { name: copy.configuracion.acciones.eliminar })).toBeVisible();
});

test("with a pending change request, groups A to D are locked and group E stays editable", async ({ page }) => {
  const emp = await empleado("bloqueo", await nuevaArea(), { nombres: "Elena", apellido: "Espinoza", dni: "95100005" });
  const service = localServiceClient();
  const { data: legajo } = await service.from("legajos").select("id").eq("profile_id", emp.id).single();
  const { data: solicitud, error } = await service
    .from("solicitudes_cambio")
    .insert({ legajo_id: legajo!.id, solicitado_por: emp.id })
    .select("id")
    .single();
  expect(error).toBeNull();
  await service.from("solicitudes_cambio_items").insert({ solicitud_id: solicitud!.id, campo: "localidad", valor_propuesto: "Localidad Pedida" });

  await loginAs(page, await admin());
  await page.goto(`/legajos/${emp.id}`);
  await expect(page.getByTestId("banner-pendiente")).toHaveText(t.detalle.solicitudPendiente);
  for (const id of ["A", "B", "C", "D"]) {
    await expect(grupo(page, id).getByRole("button", { name: ml.editar }), id).toBeDisabled();
  }
  await expect(dato(page, "B", "localidad")).toContainText(formatCopy(ml.pendiente.valor, { valor: "Localidad Pedida" }));
  await expect(grupo(page, "E").getByRole("button", { name: ml.editar })).toBeEnabled();
  await screenshotBoth(page, "legajos-detalle-bloqueado");
});

test("an Empleado cannot reach Legajos", async ({ page }) => {
  const emp = await empleado("frontera", await nuevaArea(), { nombres: "Fabio", apellido: "Funes", dni: "95100006" });
  await loginAs(page, emp);
  await expect(mainNav(page).getByRole("link", { name: copy.nav.legajos })).toHaveCount(0);
  await page.goto("/legajos");
  await expect(page).toHaveURL(/\/mi-legajo$/);
  await page.goto(`/legajos/${emp.id}`);
  await expect(page).toHaveURL(/\/mi-legajo$/);
});
