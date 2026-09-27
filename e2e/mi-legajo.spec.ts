import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { formatCopy } from "../src/lib/copy/format";
import { loginAs } from "./helpers";
import { screenshotBoth } from "./screens";
import {
  createE2EUser,
  deleteE2EUser,
  fillLegajo,
  localServiceClient,
  seedAdminClient,
  ultimaSolicitud,
} from "./service";

// F1-08: Mi Legajo (PRD US-3, US-7; Constitution §9). Each test uses its own
// throwaway accounts; requests are decided through the seed Admin's session.

const t = copy.miLegajo;
const campos = copy.aprobaciones.campos;
const created: string[] = [];

function base(suffix: string) {
  return {
    nombres: "Prueba",
    apellido: `MiLegajo${suffix}`,
    dni: "94000001",
    nacionalidad: "Argentina",
    cuil: "20-90000001-5",
    fecha_nacimiento: "1990-01-01",
    calle_altura: "Calle Falsa 123",
    localidad: "Localidad de Prueba",
    partido: "Tigre",
    telefono_celular: "11 4444-5555",
    email_personal: "e2e.personal@example.test",
    estado_civil: "soltero" as const,
    tiene_hijos: false,
    grupo_sanguineo: "0+",
    alergias: "Ninguna",
    medicacion_habitual: "Ninguna",
    obra_social: "Obra Social de Prueba",
    numero_afiliado: "E2E-1",
    emergencia_nombre: "Contacto de Prueba",
    emergencia_parentesco: "Madre",
    emergencia_domicilio: "Calle Falsa 456",
    emergencia_telefono: "11 5555-6666",
    numero_legajo: `E2E-${suffix}`,
    area: "Operaciones",
    puesto: "Técnico",
    fecha_ingreso: "2020-01-15",
    estado_laboral: "activo" as const,
    sede: "Sede de Prueba",
    modalidad: "Presencial",
    convenio: "Convenio de Prueba",
    bruto_mensual: 850000,
  };
}

async function usuario(label: string, { rol = "empleado", lleno = true }: { rol?: "empleado" | "admin"; lleno?: boolean } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const user = await createE2EUser(`${label}-${suffix}`, rol);
  created.push(user.id);
  if (lleno) await fillLegajo(user.id, base(suffix));
  return { ...user, apellido: `MiLegajo${suffix}` };
}

const grupo = (page: Page, id: string) => page.getByTestId(`grupo-${id}`);
const dato = (page: Page, id: string, campo: string) => grupo(page, id).locator(`[data-campo="${campo}"]`);

async function editar(page: Page, id: string) {
  await grupo(page, id).getByRole("button", { name: t.editar }).click();
}

async function guardar(page: Page, id: string) {
  await grupo(page, id).getByRole("button", { name: t.guardar }).click();
}

async function cambiarTelefono(page: Page, telefono: string) {
  await editar(page, "B");
  await grupo(page, "B").getByLabel(campos.telefono_celular, { exact: true }).fill(telefono);
  await guardar(page, "B");
  await expect(page.getByTestId("banner-pendiente")).toBeVisible();
}

test.afterAll(async () => {
  for (const id of created) await deleteE2EUser(id);
});

test("an Empleado sees their own data, with group E read only; nobody else's", async ({ page }) => {
  const user = await usuario("ver");
  await loginAs(page, user);
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
  await expect(dato(page, "A", "apellido")).toContainText(user.apellido);
  await expect(dato(page, "A", "fecha_nacimiento")).toContainText("01/01/1990");

  const laborales = grupo(page, "E");
  await expect(laborales.getByText(t.laboralesNota)).toBeVisible();
  await expect(laborales.locator('[data-campo="bruto_mensual"]')).toContainText(/850\.000,00/);
  await expect(laborales.locator('[data-campo="antiguedad"]')).toContainText(/años/);
  await expect(laborales.getByRole("button")).toHaveCount(0);
  await expect(laborales.getByRole("textbox")).toHaveCount(0);

  // Another employee's data never appears.
  await expect(page.getByText("Prueba Empleado A")).toHaveCount(0);
  await expect(page.getByText("90000002")).toHaveCount(0);
  await screenshotBoth(page, "mi-legajo");
});

test("saving a change creates a pending request; cancelling it restores editing", async ({ page }) => {
  const user = await usuario("pendiente");
  await loginAs(page, user);
  await cambiarTelefono(page, "11 7777-8888");

  const telefono = dato(page, "B", "telefono_celular");
  await expect(telefono).toContainText("11 4444-5555");
  await expect(telefono).toContainText(formatCopy(t.pendiente.valor, { valor: "11 7777-8888" }));
  for (const id of ["A", "B", "C", "D"]) {
    await expect(grupo(page, id).getByRole("button", { name: t.editar }), id).toBeDisabled();
  }
  const { data: legajo } = await localServiceClient().from("legajos").select("telefono_celular").eq("profile_id", user.id).single();
  expect(legajo?.telefono_celular).toBe("11 4444-5555");
  await screenshotBoth(page, "mi-legajo-pendiente");

  await page.getByRole("button", { name: t.pendiente.cancelar }).click();
  await page.getByRole("dialog", { name: t.pendiente.confirmTitle }).getByRole("button", { name: t.pendiente.confirmar }).click();
  await expect(page.getByTestId("banner-pendiente")).toHaveCount(0);
  await expect(grupo(page, "B").getByRole("button", { name: t.editar })).toBeEnabled();
  await expect(telefono).not.toContainText(t.pendiente.valor.split("{")[0].trim());
  expect((await ultimaSolicitud(user.id))?.estado).toBe("cancelada");
});

test("a rejected request shows its reason and editing is available again", async ({ page }) => {
  const user = await usuario("rechazo");
  await loginAs(page, user);
  await cambiarTelefono(page, "11 7777-0000");

  const solicitud = await ultimaSolicitud(user.id);
  const admin = await seedAdminClient();
  const { error } = await admin.rpc("rechazar_solicitud", { p_solicitud_id: solicitud!.id, p_motivo: "El teléfono no es tuyo (prueba)" });
  expect(error).toBeNull();

  await page.reload();
  await expect(page.getByTestId("banner-rechazada")).toContainText("El teléfono no es tuyo (prueba)");
  await expect(page.getByTestId("banner-pendiente")).toHaveCount(0);
  await expect(grupo(page, "B").getByRole("button", { name: t.editar })).toBeEnabled();
  await expect(dato(page, "B", "telefono_celular")).toContainText("11 4444-5555");
});

test("after the Admin approves, the page shows the new value with no banner", async ({ page }) => {
  const user = await usuario("aprobado");
  await loginAs(page, user);
  await cambiarTelefono(page, "11 7777-1111");

  const solicitud = await ultimaSolicitud(user.id);
  const admin = await seedAdminClient();
  expect((await admin.rpc("aprobar_solicitud", { p_solicitud_id: solicitud!.id })).error).toBeNull();

  await page.reload();
  const telefono = dato(page, "B", "telefono_celular");
  await expect(telefono).toContainText("11 7777-1111");
  await expect(telefono).not.toContainText("11 4444-5555");
  await expect(telefono).not.toContainText(t.pendiente.valor.split("{")[0].trim());
  await expect(page.getByTestId("banner-pendiente")).toHaveCount(0);
  await expect(page.getByTestId("banner-rechazada")).toHaveCount(0);
});

test("children: two added in the form travel in the request and appear after approval", async ({ page }) => {
  const user = await usuario("hijos");
  await loginAs(page, user);
  await editar(page, "C");
  const panel = grupo(page, "C");
  await panel.getByLabel(campos.tiene_hijos, { exact: true }).selectOption("si");
  for (const [index, [nombre, fecha]] of [["Hija Uno Prueba", "2015-04-10"], ["Hijo Dos Prueba", "2019-12-05"]].entries()) {
    await panel.getByRole("button", { name: t.hijos.agregar }).click();
    const n = formatCopy(t.hijos.hijoN, { n: String(index + 1) });
    await panel.getByLabel(`${n} · ${t.hijos.nombre}`, { exact: true }).fill(nombre);
    await panel.getByLabel(`${n} · ${t.hijos.fecha}`, { exact: true }).fill(fecha);
  }
  await guardar(page, "C");
  await expect(page.getByTestId("banner-pendiente")).toBeVisible();
  await expect(dato(page, "C", "hijos")).toContainText("Pendiente de aprobación: Hija Uno Prueba (10/04/2015); Hijo Dos Prueba (05/12/2019)");

  const solicitud = await ultimaSolicitud(user.id);
  const admin = await seedAdminClient();
  expect((await admin.rpc("aprobar_solicitud", { p_solicitud_id: solicitud!.id })).error).toBeNull();
  await page.reload();
  await expect(dato(page, "C", "hijos")).toContainText("Hija Uno Prueba (10/04/2015)");
  await expect(dato(page, "C", "hijos")).toContainText("Hijo Dos Prueba (05/12/2019)");
  await expect(dato(page, "C", "tiene_hijos")).toContainText(t.siNo.si);
});

test("documents: upload, download and delete while pending; oversized and wrong types are refused", async ({ page }) => {
  const user = await usuario("docs");
  await loginAs(page, user);
  const fila = page.getByTestId("documento-dni_frente");
  const nombre = copy.documentos.tipos.dni_frente;
  const input = page.getByLabel(formatCopy(t.documentos.archivoLabel, { documento: nombre }), { exact: true });

  await expect(fila).toContainText(t.documentos.estados.faltante);

  await input.setInputFiles({ name: "grande.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x20) });
  await expect(fila.getByRole("alert")).toHaveText(copy.documentos.validation.fileTooLarge);
  await input.setInputFiles({ name: "pagina.html", mimeType: "text/html", buffer: Buffer.from("<p>no</p>") });
  await expect(fila.getByRole("alert")).toHaveText(copy.documentos.validation.fileTypeNotAllowed);

  await input.setInputFiles({ name: "dni.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% FAKE TEST FILE - e2e\n%%EOF\n") });
  await expect(fila).toContainText(t.documentos.estados.pendiente);
  await expect(page.getByRole("status").filter({ hasText: t.documentos.exito.subido })).toBeVisible();
  await screenshotBoth(page, "mi-legajo-documentos");

  const downloadPromise = page.waitForEvent("download");
  await fila.getByRole("button", { name: t.documentos.descargarPendiente }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("dni.pdf");
  expect(download.url()).toContain("/storage/v1/object/sign/legajo-docs/");
  expect(readFileSync(await download.path(), "utf8")).toContain("FAKE TEST FILE - e2e");
  await expect(page).toHaveURL(/\/mi-legajo$/);

  await fila.getByRole("button", { name: t.documentos.eliminar }).click();
  await page.getByRole("dialog", { name: t.documentos.eliminarTitle }).getByRole("button", { name: t.documentos.eliminar }).click();
  await expect(fila).toContainText(t.documentos.estados.faltante);
});

test("an Admin editing their own legajo saves directly, with no request", async ({ page }) => {
  const user = await usuario("admin", { rol: "admin" });
  await loginAs(page, user);
  await expect(page.getByText(t.admin.nota)).toBeVisible();

  await editar(page, "D");
  await grupo(page, "D").getByLabel(campos.alergias, { exact: true }).fill("Polen (directo)");
  await guardar(page, "D");
  await expect(page.getByRole("status").filter({ hasText: t.exito.guardado })).toBeVisible();
  await expect(dato(page, "D", "alergias")).toContainText("Polen (directo)");
  await expect(page.getByTestId("banner-pendiente")).toHaveCount(0);

  const service = localServiceClient();
  const { data: legajo } = await service.from("legajos").select("id, alergias").eq("profile_id", user.id).single();
  expect(legajo?.alergias).toBe("Polen (directo)");
  const { count } = await service.from("solicitudes_cambio").select("id", { count: "exact", head: true }).eq("legajo_id", legajo!.id);
  expect(count).toBe(0);
});

test("validation: invalid CUIL, phone, future date and DNI with letters are refused per field", async ({ page }) => {
  const user = await usuario("validacion");
  await loginAs(page, user);
  const v = copy.legajo.validation;

  await editar(page, "A");
  const a = grupo(page, "A");
  await a.getByLabel(campos.cuil, { exact: true }).fill("20-90000001-6");
  await a.getByLabel(campos.dni, { exact: true }).fill("94A00001");
  await a.getByLabel(campos.fecha_nacimiento, { exact: true }).fill(`${new Date().getFullYear() + 1}-01-01`);
  await guardar(page, "A");
  await expect(a.getByText(v.cuilDigito)).toBeVisible();
  await expect(a.getByText(v.dniDigits)).toBeVisible();
  await expect(a.getByText(v.fechaFutura)).toBeVisible();
  await expect(a.getByText(t.errors.revisarCampos)).toBeVisible();
  await screenshotBoth(page, "mi-legajo-edicion");
  await a.getByRole("button", { name: t.cancelar }).click();

  await editar(page, "B");
  await grupo(page, "B").getByLabel(campos.telefono_celular, { exact: true }).fill("123");
  await guardar(page, "B");
  await expect(grupo(page, "B").getByText(v.telefonoInvalid)).toBeVisible();

  const { count } = await localServiceClient()
    .from("solicitudes_cambio")
    .select("id, legajos!inner(profile_id)", { count: "exact", head: true })
    .eq("legajos.profile_id", user.id);
  expect(count).toBe(0);
});

test("an empty legajo renders cleanly and invites the user to complete it", async ({ page }) => {
  const user = await usuario("vacio", { lleno: false });
  await loginAs(page, user);
  await expect(page.getByRole("heading", { name: t.vacio.title })).toBeVisible();
  await expect(dato(page, "A", "nombres")).toContainText(t.sinDato);
  await expect(grupo(page, "E").locator('[data-campo="antiguedad"]')).toContainText(t.sinDato);
  for (const tipo of ["dni_frente", "dni_dorso", "licencia_conducir"]) {
    await expect(page.getByTestId(`documento-${tipo}`)).toContainText(t.documentos.estados.faltante);
  }
  await expect(grupo(page, "A").getByRole("button", { name: t.editar })).toBeEnabled();
});
