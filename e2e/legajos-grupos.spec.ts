import { expect, test, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { formatCopy } from "../src/lib/copy/format";
import { adminNuevo, empleadoCompleto, hijosDe, legajoDe, registro, solicitudPendiente } from "./datos";
import { loginAs } from "./helpers";
import { localServiceClient } from "./service";

// F1-11B, GAP-05 (groups): the Admin edits every group of an employee's
// legajo in /legajos/[id] and each change is checked in the database; with a
// pending change request groups A to D (children included) are read-only and
// group E is still editable. Each test creates its own accounts.

const ml = copy.miLegajo;
const campos = copy.aprobaciones.campos;
const cuentas = registro();
test.afterAll(cuentas.limpiar);

const grupo = (page: Page, id: string) => page.getByTestId(`grupo-${id}`);
const hijo = (n: number, campo: "nombre" | "fecha") => `${formatCopy(ml.hijos.hijoN, { n: String(n) })} · ${ml.hijos[campo]}`;

async function abrirLegajo(page: Page, label: string, extra: { tieneHijos?: boolean } = {}) {
  const emp = await empleadoCompleto(label, cuentas.add, extra);
  await loginAs(page, await adminNuevo(`${label}-admin`, cuentas.add));
  await page.goto(`/legajos/${emp.id}`);
  await expect(page.getByRole("heading", { level: 1, name: emp.nombre })).toBeVisible();
  return emp;
}

async function editar(page: Page, id: string, completar: (panel: ReturnType<typeof grupo>) => Promise<void>) {
  const panel = grupo(page, id);
  await panel.getByRole("button", { name: ml.editar }).click();
  await completar(panel);
  await panel.getByRole("button", { name: ml.guardar }).click();
  // Saved: the form closes and the values are shown again.
  await expect(panel.getByRole("button", { name: ml.editar })).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
}

// Groups A, B and D: fill new values, save, and check the stored row.
const SIMPLES = [
  {
    id: "A",
    completar: async (panel: ReturnType<typeof grupo>) => {
      await panel.getByLabel(campos.nombres, { exact: true }).fill("Beatriz");
      await panel.getByLabel(campos.nacionalidad, { exact: true }).fill("Uruguaya");
      await panel.getByLabel(campos.fecha_nacimiento, { exact: true }).fill("1985-06-15");
    },
    esperado: { nombres: "Beatriz", nacionalidad: "Uruguaya", fecha_nacimiento: "1985-06-15" },
  },
  {
    id: "B",
    completar: async (panel: ReturnType<typeof grupo>) => {
      await panel.getByLabel(campos.piso_depto, { exact: true }).fill("3B");
      await panel.getByLabel(campos.partido, { exact: true }).selectOption("Otro");
      await panel.getByLabel(campos.partido_otro, { exact: true }).fill("Partido E2E");
      await panel.getByLabel(campos.telefono_celular, { exact: true }).fill("11 2222-3333");
      await panel.getByLabel(campos.email_personal, { exact: true }).fill("nuevo.e2e@example.test");
    },
    esperado: {
      piso_depto: "3B",
      partido: "Otro",
      partido_otro: "Partido E2E",
      telefono_celular: "11 2222-3333",
      email_personal: "nuevo.e2e@example.test",
    },
  },
  {
    id: "D",
    completar: async (panel: ReturnType<typeof grupo>) => {
      await panel.getByLabel(campos.alergias, { exact: true }).fill("Maní");
      await panel.getByLabel(campos.obra_social, { exact: true }).fill("Obra Social E2E");
      await panel.getByLabel(campos.emergencia_telefono, { exact: true }).fill("11 9999-0000");
    },
    esperado: { alergias: "Maní", obra_social: "Obra Social E2E", emergencia_telefono: "11 9999-0000" },
  },
] as const;

for (const caso of SIMPLES) {
  test(`the Admin edits group ${caso.id} and it is stored`, async ({ page }) => {
    const emp = await abrirLegajo(page, `grupo-${caso.id.toLowerCase()}`);
    await editar(page, caso.id, caso.completar);
    await expect.poll(async () => legajoDe(emp.id)).toMatchObject(caso.esperado);
    // Stored directly: no change request.
    const { count } = await localServiceClient().from("solicitudes_cambio").select("id", { count: "exact", head: true }).eq("legajo_id", emp.legajoId);
    expect(count).toBe(0);
  });
}

test("the Admin edits group C and its children: add, edit and remove", async ({ page }) => {
  const emp = await abrirLegajo(page, "grupo-c");
  const hijos = grupo(page, "C").locator('[data-campo="hijos"]');

  // Add two children.
  await editar(page, "C", async (panel) => {
    await panel.getByLabel(campos.estado_civil, { exact: true }).selectOption("casado");
    await panel.getByLabel(campos.nombre_conyuge, { exact: true }).fill("Cónyuge E2E");
    await panel.getByLabel(campos.tiene_hijos, { exact: true }).selectOption("si");
    await panel.getByRole("button", { name: ml.hijos.agregar }).click();
    await panel.getByLabel(hijo(1, "nombre"), { exact: true }).fill("Hijo Uno");
    await panel.getByLabel(hijo(1, "fecha"), { exact: true }).fill("2015-03-04");
    await panel.getByRole("button", { name: ml.hijos.agregar }).click();
    await panel.getByLabel(hijo(2, "nombre"), { exact: true }).fill("Hija Dos");
    await panel.getByLabel(hijo(2, "fecha"), { exact: true }).fill("2018-07-08");
  });
  await expect
    .poll(async () => legajoDe(emp.id))
    .toMatchObject({ estado_civil: "casado", nombre_conyuge: "Cónyuge E2E", tiene_hijos: true });
  await expect.poll(() => hijosDe(emp.legajoId)).toEqual([
    { nombre_completo: "Hijo Uno", fecha_nacimiento: "2015-03-04" },
    { nombre_completo: "Hija Dos", fecha_nacimiento: "2018-07-08" },
  ]);
  await expect(hijos).toContainText("Hija Dos");

  // Edit the first child.
  await editar(page, "C", async (panel) => {
    await panel.getByLabel(hijo(1, "nombre"), { exact: true }).fill("Hijo Uno Editado");
    await panel.getByLabel(hijo(1, "fecha"), { exact: true }).fill("2015-03-05");
  });
  await expect.poll(() => hijosDe(emp.legajoId)).toEqual([
    { nombre_completo: "Hijo Uno Editado", fecha_nacimiento: "2015-03-05" },
    { nombre_completo: "Hija Dos", fecha_nacimiento: "2018-07-08" },
  ]);
  await expect(hijos).toContainText("Hijo Uno Editado");

  // Remove the second child.
  await editar(page, "C", async (panel) => {
    await panel.getByTestId("hijo-row").nth(1).getByRole("button", { name: ml.hijos.quitar }).click();
    await expect(panel.getByTestId("hijo-row")).toHaveCount(1);
  });
  await expect.poll(() => hijosDe(emp.legajoId)).toEqual([{ nombre_completo: "Hijo Uno Editado", fecha_nacimiento: "2015-03-05" }]);
  await expect(hijos).not.toContainText("Hija Dos");

  // No children at all.
  await editar(page, "C", async (panel) => {
    await panel.getByTestId("hijo-row").first().getByRole("button", { name: ml.hijos.quitar }).click();
    await panel.getByLabel(campos.tiene_hijos, { exact: true }).selectOption("no");
  });
  await expect.poll(() => hijosDe(emp.legajoId)).toEqual([]);
  await expect.poll(async () => (await legajoDe(emp.id)).tiene_hijos).toBe(false);
});

test("with a pending request, groups A to D and the children are read-only, group E is saved, and A to D do not change", async ({ page }) => {
  const emp = await empleadoCompleto("bloqueo-grupos", cuentas.add, { tieneHijos: true });
  const service = localServiceClient();
  expect((await service.from("legajo_hijos").insert({ legajo_id: emp.legajoId, nombre_completo: "Hijo Bloqueado", fecha_nacimiento: "2016-01-01" })).error).toBeNull();
  await solicitudPendiente(emp, [{ campo: "alergias", valor_propuesto: "Polen" }]);
  const antes = { legajo: await legajoDe(emp.id), hijos: await hijosDe(emp.legajoId) };

  await loginAs(page, await adminNuevo("bloqueo-grupos-admin", cuentas.add));
  await page.goto(`/legajos/${emp.id}`);
  await expect(page.getByTestId("banner-pendiente")).toHaveText(copy.legajos.detalle.solicitudPendiente);
  for (const id of ["A", "B", "C", "D"]) {
    await expect(grupo(page, id).getByRole("button", { name: ml.editar }), id).toBeDisabled();
    await expect(grupo(page, id).locator("form"), id).toHaveCount(0);
  }
  // The children are listed, not editable.
  await expect(grupo(page, "C").locator('[data-campo="hijos"]')).toContainText("Hijo Bloqueado");
  await expect(grupo(page, "C").getByRole("button", { name: ml.hijos.agregar })).toHaveCount(0);

  await editar(page, "E", async (panel) => {
    await panel.getByLabel(ml.camposLaborales.puesto, { exact: true }).fill("Supervisora");
  });
  await expect.poll(async () => (await legajoDe(emp.id)).puesto).toBe("Supervisora");

  const despues = await legajoDe(emp.id);
  // Everything but the group E field just saved and the update time.
  const aD = (legajo: typeof despues) => ({ ...legajo, puesto: null, updated_at: null });
  expect(aD(despues)).toEqual(aD(antes.legajo));
  expect(await hijosDe(emp.legajoId)).toEqual(antes.hijos);
});
