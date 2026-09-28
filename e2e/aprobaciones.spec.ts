import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { formatCopy } from "../src/lib/copy/format";
import { cuilDigitoVerificador } from "../src/lib/legajo/cuil";
import { loginAs } from "./helpers";
import { screenshotBoth } from "./screens";
import { createE2EUser, deleteE2EUser, fillLegajo, localServiceClient, ultimaSolicitud } from "./service";

// F1-09B: the approvals inbox, the Admin's bell and the Admin's replacement
// modes (PRD US-4, US-7). Each test uses its own throwaway accounts, told
// apart by a unique apellido. Pending counts are global and other tests run
// in parallel, so the bell is checked for a badge, not an exact number.

const t = copy.aprobaciones;
const ml = copy.miLegajo;
const r = copy.legajos.documentos;
const created: string[] = [];
const BUCKET = "legajo-docs";

test.afterAll(async () => {
  for (const id of created) await deleteE2EUser(id);
});

function cuilPara(dni: string): string {
  for (const prefijo of ["20", "23"]) {
    const digito = cuilDigitoVerificador(`${prefijo}${dni}`);
    if (digito !== null) return `${prefijo}-${dni}-${digito}`;
  }
  throw new Error("no CUIL");
}

async function empleado(label: string, dni: string) {
  const suffix = randomUUID().slice(0, 8);
  const user = await createE2EUser(`${label}-${suffix}`);
  created.push(user.id);
  const apellido = `Bandeja${suffix}`;
  await fillLegajo(user.id, {
    nombres: "Prueba",
    apellido,
    dni,
    nacionalidad: "Argentina",
    cuil: cuilPara(dni),
    fecha_nacimiento: "1990-01-01",
    calle_altura: "Calle Falsa 123",
    localidad: "Localidad de Prueba",
    partido: "Tigre",
    telefono_celular: "11 4444-5555",
    email_personal: "e2e.personal@example.test",
    estado_civil: "soltero",
    tiene_hijos: false,
    grupo_sanguineo: "0+",
    alergias: "Ninguna",
    medicacion_habitual: "Ninguna",
    obra_social: "Obra Social de Prueba",
    numero_afiliado: "123",
    emergencia_nombre: "Contacto",
    emergencia_parentesco: "Madre",
    emergencia_domicilio: "Calle 2",
    emergencia_telefono: "11 5555-6666",
    numero_legajo: `B-${suffix}`,
  });
  return { ...user, apellido, nombre: `Prueba ${apellido}` };
}

async function admin() {
  const user = await createE2EUser(`bandeja-admin-${randomUUID().slice(0, 8)}`, "admin");
  created.push(user.id);
  return user;
}

async function otraSesion(browser: Browser, user: { email: string; password: string }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, user);
  return page;
}

const campana = (page: Page) => page.getByTestId("campana").filter({ visible: true });
const itemDe = (page: Page, nombre: string) => page.getByTestId("bandeja-item").filter({ hasText: nombre });
const grupo = (page: Page, id: string) => page.getByTestId(`grupo-${id}`);
const dato = (page: Page, id: string, campo: string) => grupo(page, id).locator(`[data-campo="${campo}"]`);
const pdf = (label: string) => ({ name: `${label}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% FAKE TEST FILE - ${label}\n%%EOF\n`) });

// A stored object plus its row (service role), approved by the Admin or pending.
async function documento(owner: { id: string }, tipo: "dni_frente" | "dni_dorso", estado: "aprobado" | "pendiente", label: string, revisor?: string) {
  const service = localServiceClient();
  const { data: legajo } = await service.from("legajos").select("id").eq("profile_id", owner.id).single();
  const path = `${owner.id}/${tipo}/${randomUUID()}.pdf`;
  const file = pdf(label);
  const uploaded = await service.storage.from(BUCKET).upload(path, file.buffer, { contentType: "application/pdf" });
  expect(uploaded.error).toBeNull();
  const { data, error } = await service
    .from("legajo_documentos")
    .insert({
      legajo_id: legajo!.id,
      tipo,
      storage_path: path,
      file_name: file.name,
      mime_type: "application/pdf",
      size_bytes: file.buffer.length,
      uploaded_by: revisor ?? owner.id,
      estado,
      ...(estado === "aprobado" ? { revisado_por: revisor, revisado_en: new Date().toISOString() } : {}),
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return { id: data!.id, path };
}

test("a change request: bell, inbox, comparison, approval, and the employee sees it applied", async ({ page, browser }) => {
  const emp = await empleado("aprobar", "96100001");
  const empPage = await otraSesion(browser, emp);
  await grupo(empPage, "B").getByRole("button", { name: ml.editar }).click();
  await grupo(empPage, "B").getByLabel(t.campos.telefono_celular, { exact: true }).fill("11 7777-8888");
  await grupo(empPage, "B").getByRole("button", { name: ml.guardar }).click();
  await expect(empPage.getByTestId("banner-pendiente")).toBeVisible();

  await loginAs(page, await admin());
  // The bell shows pending items and opens the inbox.
  await expect(campana(page).getByTestId("campana-conteo")).toHaveText(/^([1-9]|9\+)$/);
  await expect(campana(page)).toHaveAccessibleName(/Aprobaciones: \d+ pendientes/);
  await campana(page).click();
  await expect(page).toHaveURL(/\/aprobaciones$/);
  await expect(page.getByRole("heading", { level: 1, name: t.bandeja.title })).toBeVisible();
  const item = itemDe(page, emp.nombre);
  await expect(item).toContainText(formatCopy(t.bandeja.tipoSolicitud, { grupos: ml.grupos.B }));
  await screenshotBoth(page, "aprobaciones-bandeja");

  await item.getByRole("link", { name: t.bandeja.revisar }).click();
  await expect(page).toHaveURL(/\/aprobaciones\/solicitudes\//);
  await expect(page.getByRole("heading", { level: 1, name: emp.nombre })).toBeVisible();
  const fila = page.getByTestId("comparacion-B").locator('[data-campo="telefono_celular"]');
  await expect(fila.locator('[data-valor="actual"]')).toHaveText("11 4444-5555");
  await expect(fila.locator('[data-valor="propuesto"]')).toHaveText("11 7777-8888");
  // Only the changed field is compared.
  await expect(page.getByTestId("comparacion-B").locator("[data-campo]")).toHaveCount(1);
  await screenshotBoth(page, "aprobaciones-solicitud");

  await page.getByTestId("decision").getByRole("button", { name: t.detalle.aprobar }).click();
  await expect(page).toHaveURL(/\/aprobaciones\?resultado=solicitudAprobada$/);
  await expect(page.getByTestId("resultado-decision")).toHaveText(t.exito.solicitudAprobada);
  await expect(itemDe(page, emp.nombre)).toHaveCount(0);

  await empPage.reload();
  await expect(empPage.getByTestId("banner-pendiente")).toHaveCount(0);
  await expect(dato(empPage, "B", "telefono_celular")).toHaveText(new RegExp("11 7777-8888"));
  expect((await ultimaSolicitud(emp.id))?.estado).toBe("aprobada");
  await empPage.context().close();
});

test("a rejection needs a reason, and the employee sees it", async ({ page, browser }) => {
  const emp = await empleado("rechazar", "96100002");
  const empPage = await otraSesion(browser, emp);
  await grupo(empPage, "D").getByRole("button", { name: ml.editar }).click();
  await grupo(empPage, "D").getByLabel(t.campos.alergias, { exact: true }).fill("Polen");
  await grupo(empPage, "D").getByRole("button", { name: ml.guardar }).click();
  await expect(empPage.getByTestId("banner-pendiente")).toBeVisible();
  const solicitud = await ultimaSolicitud(emp.id);

  await loginAs(page, await admin());
  await page.goto(`/aprobaciones/solicitudes/${solicitud!.id}`);
  await page.getByTestId("decision").getByRole("button", { name: t.detalle.rechazar }).click();
  const dialog = page.getByRole("dialog", { name: t.detalle.rechazarTitle });
  await dialog.getByRole("button", { name: t.detalle.confirmarRechazo }).click();
  await expect(dialog.getByText(t.errors.motivoRequerido)).toBeVisible();
  await dialog.getByLabel(t.motivoRechazoLabel, { exact: true }).fill("Adjuntá el certificado de alergias.");
  await screenshotBoth(page, "aprobaciones-rechazo");
  await dialog.getByRole("button", { name: t.detalle.confirmarRechazo }).click();
  await expect(page).toHaveURL(/\/aprobaciones\?resultado=solicitudRechazada$/);

  await empPage.reload();
  await expect(empPage.getByTestId("banner-rechazada")).toContainText("Adjuntá el certificado de alergias.");
  await expect(dato(empPage, "D", "alergias")).toHaveText(/Ninguna/);
  await empPage.context().close();
});

test("a pending document is previewed beside the current one, then approved or rejected", async ({ page, browser }) => {
  const emp = await empleado("documentos", "96100003");
  const adminUser = await admin();
  await documento(emp, "dni_frente", "aprobado", "frente vigente", adminUser.id);
  const frente = await documento(emp, "dni_frente", "pendiente", "frente nuevo");
  const dorso = await documento(emp, "dni_dorso", "pendiente", "dorso nuevo");

  await loginAs(page, adminUser);
  await page.goto("/aprobaciones");
  await expect(itemDe(page, emp.nombre)).toHaveCount(2);
  await itemDe(page, emp.nombre)
    .filter({ hasText: copy.documentos.tipos.dni_frente })
    .getByRole("link", { name: t.bandeja.revisar })
    .click();
  await expect(page).toHaveURL(new RegExp(`/aprobaciones/documentos/${frente.id}$`));
  await expect(page.getByTestId("archivo-enviado")).toContainText("frente nuevo.pdf");
  await expect(page.getByTestId("archivo-vigente")).toContainText("frente vigente.pdf");
  const download = page.waitForEvent("download");
  await page.getByTestId("archivo-enviado").getByRole("button", { name: t.detalle.documento.descargar }).click();
  expect((await download).suggestedFilename()).toBe("frente nuevo.pdf");
  await page.getByTestId("decision").getByRole("button", { name: t.detalle.aprobar }).click();
  await expect(page).toHaveURL(/resultado=documentoAprobado$/);

  await page.goto(`/aprobaciones/documentos/${dorso.id}`);
  await expect(page.getByTestId("archivo-vigente")).toContainText(t.detalle.documento.sinVigente);
  await page.getByTestId("decision").getByRole("button", { name: t.detalle.rechazar }).click();
  const dialog = page.getByRole("dialog", { name: t.detalle.rechazarDocumentoTitle });
  await dialog.getByLabel(t.motivoRechazoLabel, { exact: true }).fill("La foto está borrosa.");
  await dialog.getByRole("button", { name: t.detalle.confirmarRechazo }).click();
  await expect(page).toHaveURL(/resultado=documentoRechazado$/);
  await expect(itemDe(page, emp.nombre)).toHaveCount(0);

  const empPage = await otraSesion(browser, emp);
  await expect(empPage.getByTestId("documento-dni_frente")).toContainText(ml.documentos.estados.aprobado);
  await expect(empPage.getByTestId("documento-dni_dorso")).toContainText(
    formatCopy(ml.documentos.motivoRechazo, { motivo: "La foto está borrosa." }),
  );
  await empPage.context().close();
});

test("an item decided in another tab gets a controlled message", async ({ page, browser }) => {
  const emp = await empleado("otra-pestana", "96100004");
  const adminUser = await admin();
  const doc = await documento(emp, "dni_dorso", "pendiente", "dos pestañas");
  await loginAs(page, adminUser);
  await page.goto(`/aprobaciones/documentos/${doc.id}`);

  const other = await otraSesion(browser, adminUser);
  await other.goto(`/aprobaciones/documentos/${doc.id}`);
  await other.getByTestId("decision").getByRole("button", { name: t.detalle.aprobar }).click();
  await expect(other).toHaveURL(/resultado=documentoAprobado$/);
  await other.context().close();

  await page.getByTestId("decision").getByRole("button", { name: t.detalle.aprobar }).click();
  await expect(page.getByTestId("detalle-no-disponible").or(page.getByTestId("decision-error"))).toContainText(t.errors.yaDecidido);
});

test("the Admin replaces a document keeping history, then for good after confirming", async ({ page }) => {
  const emp = await empleado("reemplazo", "96100005");
  const adminUser = await admin();
  const original = await documento(emp, "dni_frente", "aprobado", "original", adminUser.id);
  await loginAs(page, adminUser);
  await page.goto(`/legajos/${emp.id}`);
  const fila = page.getByTestId("documento-dni_frente");

  // Keep history.
  await fila.getByRole("button", { name: r.reemplazar }).click();
  const dialog = page.getByRole("dialog", { name: formatCopy(r.reemplazarTitle, { documento: copy.documentos.tipos.dni_frente }) });
  await expect(dialog.getByRole("radio", { name: new RegExp(r.conservar.label) })).toBeChecked();
  await screenshotBoth(page, "legajos-reemplazo");
  let chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: r.elegirArchivo }).click();
  await (await chooser).setFiles(pdf("segundo"));
  await expect(page.getByRole("status").filter({ hasText: r.reemplazado })).toBeVisible();
  const historial = page.getByTestId("historial-dni_frente");
  await expect(historial.getByTestId("historial-version")).toHaveCount(1);
  await expect(historial).toContainText("original.pdf");

  const service = localServiceClient();
  // File name and state of each dni_frente row, oldest first.
  const estados = async () =>
    (
      (await service.from("legajo_documentos").select("estado, file_name").eq("tipo", "dni_frente").like("storage_path", `${emp.id}/%`).order("created_at"))
        .data ?? []
    ).map((doc) => [doc.file_name, doc.estado]);
  await expect.poll(estados).toEqual([
    ["original.pdf", "reemplazado"],
    ["segundo.pdf", "aprobado"],
  ]);

  // For good, with the explicit confirmation.
  await fila.getByRole("button", { name: r.reemplazar }).click();
  await dialog.getByRole("radio", { name: new RegExp(r.definitivo.label) }).check();
  await dialog.getByRole("button", { name: r.definitivo.label }).click();
  const confirm = page.getByRole("dialog", { name: r.confirmarTitle });
  await expect(confirm.getByTestId("reemplazo-confirmacion")).toContainText("segundo.pdf");
  await screenshotBoth(page, "legajos-reemplazo-confirmacion");
  chooser = page.waitForEvent("filechooser");
  await confirm.getByRole("button", { name: r.confirmar }).click();
  await (await chooser).setFiles(pdf("tercero"));
  // The success message is already on the page from the first replacement:
  // wait for the stored state instead.
  await expect.poll(estados).toEqual([
    ["original.pdf", "reemplazado"],
    ["tercero.pdf", "aprobado"],
  ]);
  await expect(page.getByRole("status").filter({ hasText: r.reemplazado })).toBeVisible();
  await expect(historial.getByTestId("historial-version")).toHaveCount(1);
  expect((await service.storage.from(BUCKET).download(original.path)).data).not.toBeNull();

  // The history version downloads.
  const download = page.waitForEvent("download");
  await historial.getByRole("button", { name: ml.documentos.descargar }).click();
  expect((await download).suggestedFilename()).toBe("original.pdf");
});

test("an Empleado sees no bell and cannot reach the inbox", async ({ page }) => {
  const emp = await empleado("frontera", "96100006");
  await loginAs(page, emp);
  await expect(page.getByTestId("campana")).toHaveCount(0);
  for (const path of ["/aprobaciones", `/aprobaciones/solicitudes/${randomUUID()}`, `/aprobaciones/documentos/${randomUUID()}`]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/mi-legajo$/);
  }
  await expect(page.getByTestId("campana")).toHaveCount(0);
});
