import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { formatCopy } from "../src/lib/copy/format";
import { cuilDigitoVerificador } from "../src/lib/legajo/cuil";
import { loginAs, mainNav } from "./helpers";
import { screenshotBoth } from "./screens";
import { createE2EUser, deleteE2EUser, fillLegajo, localServiceClient, seedAdminClient } from "./service";

// F1-09A: Legajos (Admin): list, detail, direct editing and documents (PRD
// US-4, US-8). Each test uses its own throwaway accounts, told apart from any
// other data by a unique área.

const t = copy.legajos;
const ml = copy.miLegajo;
const campos = copy.aprobaciones.campos;
const created: string[] = [];

test.afterAll(async () => {
  for (const id of created) await deleteE2EUser(id);
});

// A valid CUIL for a DNI (prefix 20, or 23 when 20 has no check digit).
function cuilPara(dni: string): string {
  for (const prefijo of ["20", "23"]) {
    const digito = cuilDigitoVerificador(`${prefijo}${dni}`);
    if (digito !== null) return `${prefijo}-${dni}-${digito}`;
  }
  throw new Error("no CUIL");
}

async function empleado(label: string, area: string, extra: { nombres: string; apellido: string; dni: string; sede?: string; modalidad?: string }) {
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
    numero_legajo: `L-${suffix}`,
    area,
    puesto: "Técnico",
    fecha_ingreso: "2020-01-15",
    estado_laboral: "activo",
    sede: extra.sede ?? "Sede Norte",
    modalidad: extra.modalidad ?? "Presencial",
    convenio: "Convenio de Prueba",
    bruto_mensual: 850000,
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
  const { data, error } = await localServiceClient().from("legajos").select("fecha_ingreso, estado_laboral, profiles!inner(estado_cuenta)");
  if (error) throw new Error(`kpi setup failed: ${error.message}`);
  const activos = (data ?? []).filter(
    (fila) =>
      fila.profiles.estado_cuenta === "activa" && (fila.estado_laboral === "activo" || fila.estado_laboral === "en_prueba"),
  );
  return {
    mes,
    activos: activos.length,
    ingresosDelMes: activos.filter((fila) => fila.fecha_ingreso?.slice(0, 7) === mes).length,
  };
}
const grupo = (page: Page, id: string) => page.getByTestId(`grupo-${id}`);
const dato = (page: Page, id: string, campo: string) => grupo(page, id).locator(`[data-campo="${campo}"]`);

test("the Admin filters, searches and shows deactivated employees in the list", async ({ page }) => {
  const area = `Área E2E ${randomUUID().slice(0, 6)}`;
  const ana = await empleado("lista-ana", area, { nombres: "Ana", apellido: "Aguirre", dni: "95100001", sede: "Sede Norte" });
  const beto = await empleado("lista-beto", area, { nombres: "Beto", apellido: "Benítez", dni: "95100002", sede: "Sede Sur", modalidad: "Remota" });
  const baja = await empleado("lista-baja", area, { nombres: "Carla", apellido: "Castro", dni: "95100003" });
  const seedAdmin = await seedAdminClient();
  const desactivada = await seedAdmin.rpc("desactivar_cuenta", { p_profile_id: baja.id, p_motivo: "Prueba e2e" });
  expect(desactivada.error).toBeNull();

  await loginAs(page, await admin());
  await mainNav(page).getByRole("link", { name: copy.nav.legajos }).click();
  await expect(page).toHaveURL(/\/legajos$/);
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();

  // Área filter: only this test's employees; the deactivated one hidden.
  await page.getByLabel(t.filtros.area, { exact: true }).selectOption(area);
  await expect(filas(page)).toHaveCount(2);
  await expect(filas(page).nth(0)).toContainText("Ana Aguirre");
  await expect(filas(page).nth(1)).toContainText("Beto Benítez");
  await expect(filas(page).nth(0)).toContainText(formatCopy(t.numeroLegajo, { numero: ana.numeroLegajo }));
  await screenshotBoth(page, "legajos-lista");

  // Sede and modalidad filters.
  await page.getByLabel(t.filtros.sede, { exact: true }).selectOption("Sede Sur");
  await expect(filas(page)).toHaveCount(1);
  await expect(filas(page)).toContainText("Beto Benítez");
  await page.getByLabel(t.filtros.sede, { exact: true }).selectOption("");
  await page.getByLabel(t.filtros.modalidad, { exact: true }).selectOption("Remota");
  await expect(filas(page)).toHaveCount(1);
  await page.getByLabel(t.filtros.modalidad, { exact: true }).selectOption("");
  await page.getByLabel(t.filtros.estadoLaboral, { exact: true }).selectOption("en_prueba");
  await expect(page.getByText(t.sinResultados)).toBeVisible();
  await page.getByLabel(t.filtros.estadoLaboral, { exact: true }).selectOption("");

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
  await expect(page.getByLabel(t.filtros.area, { exact: true })).toHaveValue("");
  await expect(page.getByLabel(t.filtros.mostrarBajas, { exact: true })).not.toBeChecked();
});

test("the KPI cards show Activos and Ingresos del mes for the whole workforce, and nothing else", async ({ page }) => {
  // One active employee who joined this month (Argentina), so the count is not trivially zero.
  const { mes } = await kpisEsperados();
  const area = `Área E2E ${randomUUID().slice(0, 6)}`;
  const nuevo = await empleado("kpi", area, { nombres: "Gala", apellido: "Gómez", dni: "95100007" });
  await fillLegajo(nuevo.id, { fecha_ingreso: `${mes}-01` });

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
  await page.getByLabel(t.filtros.area, { exact: true }).selectOption(area);
  await page.getByLabel(t.busqueda.label, { exact: true }).fill("gomez");
  await page.getByLabel(t.filtros.mostrarBajas, { exact: true }).check();
  await expect(filas(page)).toHaveCount(1);
  await expect(kpi(page, "activos")).toHaveText(antes.activos ?? "");
  await expect(kpi(page, "ingresos-del-mes")).toHaveText(antes.ingresos ?? "");
});

test("the Admin opens a legajo, edits groups E and A directly, and uploads and downloads a document", async ({ page }) => {
  const area = `Área E2E ${randomUUID().slice(0, 6)}`;
  const emp = await empleado("detalle", area, { nombres: "Diego", apellido: "Duarte", dni: "95100004" });
  const adminUser = await admin();
  await loginAs(page, adminUser);
  await page.goto("/legajos");
  await page.getByLabel(t.filtros.area, { exact: true }).selectOption(area);
  await filas(page).first().click();
  await expect(page).toHaveURL(new RegExp(`/legajos/${emp.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Diego Duarte" })).toBeVisible();
  await expect(page.getByText(t.detalle.nota)).toBeVisible();

  // Group E.
  await grupo(page, "E").getByRole("button", { name: ml.editar }).click();
  await grupo(page, "E").getByLabel(ml.camposLaborales.puesto, { exact: true }).fill("Supervisor");
  await grupo(page, "E").getByLabel(ml.camposLaborales.bruto_mensual, { exact: true }).fill("1.250.000,50");
  await grupo(page, "E").getByRole("button", { name: ml.guardar }).click();
  await expect(page.getByRole("status").filter({ hasText: ml.exito.guardado })).toBeVisible();
  await expect(dato(page, "E", "puesto")).toContainText("Supervisor");
  await expect(dato(page, "E", "bruto_mensual")).toContainText(/1\.250\.000,50/);

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
  const { data: legajo } = await service.from("legajos").select("id, puesto, nombres, bruto_mensual").eq("profile_id", emp.id).single();
  expect(legajo).toMatchObject({ puesto: "Supervisor", nombres: "Diego Martín", bruto_mensual: 1250000.5 });
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
});

test("with a pending change request, groups A to D are locked and group E stays editable", async ({ page }) => {
  const emp = await empleado("bloqueo", `Área E2E ${randomUUID().slice(0, 6)}`, { nombres: "Elena", apellido: "Espinoza", dni: "95100005" });
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
  const emp = await empleado("frontera", `Área E2E ${randomUUID().slice(0, 6)}`, { nombres: "Fabio", apellido: "Funes", dni: "95100006" });
  await loginAs(page, emp);
  await expect(mainNav(page).getByRole("link", { name: copy.nav.legajos })).toHaveCount(0);
  await page.goto("/legajos");
  await expect(page).toHaveURL(/\/mi-legajo$/);
  await page.goto(`/legajos/${emp.id}`);
  await expect(page).toHaveURL(/\/mi-legajo$/);
});
