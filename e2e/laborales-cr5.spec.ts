import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { copyLaborales } from "../src/lib/copy/laborales";
import { formatCopy } from "../src/lib/copy/format";
import { adminNuevo, empleadoCompleto, registro } from "./datos";
import { loginAs } from "./helpers";
import { fillLaboral, itemIdE2E, localServiceClient } from "./service";

// CR-5: a Puesto's Sucursal por defecto (set in Configuración, prefilled in
// the legajo and still editable), the "No" convenio (Tarea and Categoría
// disabled and cleared, read as "No aplica") and its system item in
// Configuración, and the employee's Mi Legajo still without group E. The
// Área, Puesto and Sucursal created here carry a unique prefix and are
// removed after, with their history; the seeded items are not changed.

const t = copy.configuracion;
const ml = copy.miLegajo;
const cuentas = registro();
const actores: string[] = [];
const MARCA = `E2E CR5 ${randomUUID().slice(0, 8)}`;

test.afterAll(async () => {
  const service = localServiceClient();
  if (actores.length) await service.from("catalogo_eventos").delete().in("actor_id", actores);
  // The legajos go first: their group E may reference the items.
  await cuentas.limpiar();
  await service.from("catalogo_items").update({ sucursal_defecto_id: null }).like("nombre", `${MARCA}%`);
  await service.from("catalogo_items").delete().like("nombre", `${MARCA}%`).eq("lista", "puesto");
  await service.from("catalogo_items").delete().like("nombre", `${MARCA}%`);
});

const grupoE = (page: Page) => page.getByTestId("grupo-E");
const etiqueta = (campo: keyof typeof copyLaborales.campos, obligatorio: boolean) =>
  obligatorio ? formatCopy(copyLaborales.form.obligatorio, { campo: copyLaborales.campos[campo] }) : copyLaborales.campos[campo];
const select = (page: Page, campo: keyof typeof copyLaborales.campos, obligatorio = false) =>
  grupoE(page).getByLabel(etiqueta(campo, obligatorio), { exact: true });

function fila(page: Page, nombre: string) {
  return page.getByTestId("catalogo-item").filter({ has: page.getByText(nombre, { exact: true }) });
}

async function laboral(legajoId: string) {
  const { data } = await localServiceClient().from("legajos_laborales").select("*").eq("legajo_id", legajoId).single();
  return data!;
}

async function abrirEdicion(page: Page, profileId: string) {
  await page.goto(`/legajos/${profileId}`);
  await grupoE(page).getByRole("button", { name: ml.editar }).click();
}

async function guardar(page: Page) {
  await grupoE(page).getByRole("button", { name: ml.guardar }).click();
  await expect(grupoE(page).getByRole("button", { name: ml.editar })).toBeVisible();
  await expect(grupoE(page).getByRole("alert")).toHaveCount(0);
}

test("an Admin sets a Puesto's Sucursal por defecto; picking that Puesto prefills the Sucursal, which can still be changed", async ({ page }) => {
  const service = localServiceClient();
  const areaNombre = `${MARCA} Área`;
  const puestoNombre = `${MARCA} Mostrador`;
  const { data: area } = await service.from("catalogo_items").insert({ lista: "area", nombre: areaNombre }).select("id").single();
  const { data: puesto } = await service.from("catalogo_items").insert({ lista: "puesto", area_id: area!.id, nombre: puestoNombre }).select("id").single();
  const sanJusto = await itemIdE2E("sucursal", "San Justo");
  const pacheco = await itemIdE2E("sucursal", "Pacheco");

  const emp = await empleadoCompleto("cr5-defecto", cuentas.add);
  const admin = await adminNuevo("cr5-defecto-admin", cuentas.add);
  actores.push(admin.id);
  await loginAs(page, admin);

  // Configuración: the Puesto has none yet; set San Justo.
  await page.goto("/configuracion?lista=puesto");
  const item = fila(page, puestoNombre);
  await expect(item.getByTestId("sucursal-defecto")).toHaveText(t.sucursalDefecto.ninguna);
  await item.getByRole("button", { name: t.sucursalDefecto.accion }).click();
  const dialogo = page.getByRole("dialog", { name: formatCopy(t.sucursalDefecto.title, { nombre: puestoNombre }) });
  await dialogo.getByLabel(t.sucursalDefecto.label, { exact: true }).selectOption({ label: "San Justo" });
  await dialogo.getByRole("button", { name: t.sucursalDefecto.confirm }).click();
  await expect(page.getByRole("status").filter({ hasText: formatCopy(t.exito.sucursalDefecto, { nombre: puestoNombre }) })).toBeVisible();
  await expect(item.getByTestId("sucursal-defecto")).toHaveText(formatCopy(t.sucursalDefecto.valor, { nombre: "San Justo" }));
  await expect.poll(async () => (await service.from("catalogo_items").select("sucursal_defecto_id").eq("id", puesto!.id).single()).data?.sucursal_defecto_id).toBe(sanJusto);

  // The legajo: the stored Sucursal (Casa Central) is not changed on load.
  await abrirEdicion(page, emp.id);
  await expect(select(page, "sucursal", true)).toHaveValue(await itemIdE2E("sucursal", "Casa Central"));
  await select(page, "area", true).selectOption({ label: areaNombre });
  await select(page, "puesto", true).selectOption({ label: puestoNombre });
  await expect(select(page, "sucursal", true)).toHaveValue(sanJusto);
  // Still editable.
  await select(page, "sucursal", true).selectOption({ label: "Pacheco" });
  await guardar(page);
  await expect.poll(async () => (await laboral(emp.legajoId)).sucursal_id).toBe(pacheco);
  expect((await laboral(emp.legajoId)).puesto_id).toBe(puesto!.id);

  // Opening the form again keeps Pacheco: the prefill happens only when the
  // Admin picks the Puesto.
  await grupoE(page).getByRole("button", { name: ml.editar }).click();
  await expect(select(page, "sucursal", true)).toHaveValue(pacheco);
});

test("Convenio No disables and clears Tarea and Categoría and saves; Comercio enables them again", async ({ page }) => {
  const emp = await empleadoCompleto("cr5-convenio", cuentas.add);
  await loginAs(page, await adminNuevo("cr5-convenio-admin", cuentas.add));
  const no = await itemIdE2E("convenio", "No");
  const comercio = await itemIdE2E("convenio", "Comercio");

  await abrirEdicion(page, emp.id);
  // Convenio before Tarea and Categoría, and required.
  const etiquetas = await grupoE(page).locator("label").allInnerTexts();
  const indice = (texto: string) => etiquetas.findIndex((e) => e.trim().toUpperCase() === texto.toUpperCase());
  expect(indice(etiqueta("convenio", true))).toBeGreaterThanOrEqual(0);
  expect(indice(etiqueta("convenio", true))).toBeLessThan(indice(etiqueta("tarea", false)));
  expect(indice(etiqueta("tarea", false))).toBeLessThan(indice(etiqueta("categoria", false)));

  await expect(select(page, "tarea")).toBeEnabled();
  await select(page, "convenio", true).selectOption({ label: "No" });
  for (const campo of ["tarea", "categoria"] as const) {
    await expect(select(page, campo), campo).toBeDisabled();
    await expect(select(page, campo), campo).toHaveValue("");
  }
  await expect(grupoE(page).getByText(copyLaborales.form.sinConvenioNota, { exact: true })).toHaveCount(2);
  await guardar(page);
  await expect.poll(async () => (await laboral(emp.legajoId)).convenio_id).toBe(no);
  expect(await laboral(emp.legajoId)).toMatchObject({ tarea_id: null, categoria_id: null });
  // The read view: No aplica.
  for (const campo of ["tarea", "categoria"]) {
    await expect(grupoE(page).locator(`[data-campo="${campo}"] dd`)).toHaveText(copyLaborales.form.noAplica);
  }
  await expect(grupoE(page).locator('[data-campo="convenio"] dd')).toHaveText("No");

  // Comercio: enabled again.
  await grupoE(page).getByRole("button", { name: ml.editar }).click();
  await select(page, "convenio", true).selectOption({ label: "Comercio" });
  await expect(select(page, "tarea")).toBeEnabled();
  await expect(select(page, "categoria")).toBeEnabled();
  await select(page, "tarea").selectOption({ label: "Cajero" });
  await select(page, "categoria").selectOption({ label: "B" });
  await guardar(page);
  await expect.poll(async () => (await laboral(emp.legajoId)).convenio_id).toBe(comercio);
  expect(await laboral(emp.legajoId)).toMatchObject({
    tarea_id: await itemIdE2E("tarea", "Cajero"),
    categoria_id: await itemIdE2E("categoria", "B"),
  });
});

test("Configuración shows No as a system item: no rename, deactivate or delete", async ({ page }) => {
  await loginAs(page, await adminNuevo("cr5-sistema", cuentas.add));
  await page.goto("/configuracion?lista=convenio");
  const no = fila(page, "No");
  await expect(no.getByText(t.sistema, { exact: true })).toBeVisible();
  await expect(no.getByText(t.sistemaHint, { exact: true })).toBeVisible();
  for (const accion of [t.acciones.renombrar, t.acciones.desactivar, t.acciones.eliminar]) {
    await expect(no.getByRole("button", { name: accion, exact: true }), accion).toHaveCount(0);
  }
  // It can be reordered: the move buttons are there.
  await expect(no.getByRole("button", { name: formatCopy(t.acciones.subir, { nombre: "No" }) })).toBeVisible();
  const comercio = fila(page, "Comercio");
  await expect(comercio.getByText(t.sistema, { exact: true })).toHaveCount(0);
  await expect(comercio.getByRole("button", { name: t.acciones.renombrar, exact: true })).toBeVisible();
});

test("an Empleado with Convenio No still gets no group E in Mi Legajo (HTML and RSC)", async ({ page }) => {
  const emp = await empleadoCompleto("cr5-empleado", cuentas.add);
  const numero = `CR5-${randomUUID().slice(0, 8)}`;
  await fillLaboral(emp.id, { numero_legajo: numero, convenio: "No", tarea: null, categoria: null });
  await loginAs(page, emp);
  await expect(page.getByTestId("grupo-A")).toBeVisible();
  await expect(page.getByTestId("grupo-E")).toHaveCount(0);
  await expect(page.getByTestId("grupo-E-propio")).toHaveCount(0);
  for (const headers of [{}, { RSC: "1" }] as Record<string, string>[]) {
    const respuesta = await page.request.get("/mi-legajo", { headers });
    expect(respuesta.ok()).toBe(true);
    const cuerpo = await respuesta.text();
    expect(cuerpo, JSON.stringify(headers)).toContain(emp.apellido);
    for (const marca of [
      numero,
      copyLaborales.grupo,
      copyLaborales.form.noAplica,
      copyLaborales.form.sinConvenioNota,
      "grupo-E-propio",
      "convenio_id",
      "sin_convenio",
    ]) {
      expect(cuerpo, `${JSON.stringify(headers)} ${marca}`).not.toContain(marca);
    }
  }
});
