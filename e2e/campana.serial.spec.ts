import { expect, test, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { formatCopy } from "../src/lib/copy/format";
import { adminNuevo, documentoPendiente, empleadoCompleto, registro, solicitudPendiente } from "./datos";
import { loginAs } from "./helpers";
import { screenshotBoth } from "./screens";
import { localServiceClient } from "./service";

// F1-11B, GAP-06 (bell): no badge at zero, the exact count, and 9+ above nine,
// with the exact count in the accessible name. The count is global, so this
// file runs in the "serial" project, after every other test has finished
// (playwright.config.ts). Pending items left by the seed are set aside for
// the test (not pending) and restored afterwards, exactly as they were.

const cuentas = registro();
test.afterAll(cuentas.limpiar);

const campana = (page: Page) => page.getByTestId("campana").filter({ visible: true });

type Apartados = { solicitudes: string[]; documentos: string[] };

async function apartarPendientes(revisor: string): Promise<Apartados> {
  const service = localServiceClient();
  const solicitudes = ((await service.from("solicitudes_cambio").select("id").eq("estado", "pendiente")).data ?? []).map((s) => s.id);
  const documentos = ((await service.from("legajo_documentos").select("id").eq("estado", "pendiente")).data ?? []).map((d) => d.id);
  if (solicitudes.length) {
    expect((await service.from("solicitudes_cambio").update({ estado: "cancelada" }).in("id", solicitudes)).error).toBeNull();
  }
  if (documentos.length) {
    const apartado = await service
      .from("legajo_documentos")
      .update({ estado: "rechazado", motivo_rechazo: "Apartado por la prueba de la campana", revisado_por: revisor, revisado_en: new Date().toISOString() })
      .in("id", documentos);
    expect(apartado.error).toBeNull();
  }
  return { solicitudes, documentos };
}

async function restaurar({ solicitudes, documentos }: Apartados) {
  const service = localServiceClient();
  if (solicitudes.length) await service.from("solicitudes_cambio").update({ estado: "pendiente" }).in("id", solicitudes);
  if (documentos.length) {
    await service
      .from("legajo_documentos")
      .update({ estado: "pendiente", motivo_rechazo: null, revisado_por: null, revisado_en: null })
      .in("id", documentos);
  }
}

test("the bell: no badge at zero, the exact count, and 9+ above nine", async ({ page }) => {
  const admin = await adminNuevo("campana-admin", cuentas.add);
  const apartados = await apartarPendientes(admin.id);
  try {
    const service = localServiceClient();
    for (const tabla of ["solicitudes_cambio", "legajo_documentos"] as const) {
      const { count } = await service.from(tabla).select("id", { count: "exact", head: true }).eq("estado", "pendiente");
      expect(count, tabla).toBe(0);
    }

    // Zero: a neutral bell, no badge.
    await loginAs(page, admin);
    await expect(campana(page)).toHaveAccessibleName(copy.campana.sinPendientes);
    await expect(campana(page).getByTestId("campana-conteo")).toHaveCount(0);
    await page.goto("/aprobaciones");
    await expect(page.getByTestId("bandeja-vacia")).toHaveText(copy.aprobaciones.bandeja.vacio);

    // One.
    const uno = await empleadoCompleto("campana-uno", cuentas.add);
    await solicitudPendiente(uno, [{ campo: "alergias", valor_propuesto: "Polen" }]);
    await page.reload();
    await expect(campana(page).getByTestId("campana-conteo")).toHaveText("1");
    await expect(campana(page)).toHaveAccessibleName(formatCopy(copy.campana.pendientes, { n: "1" }));

    // Eleven: the badge says 9+, the name the exact count.
    for (const tipo of ["dni_frente", "dni_dorso", "licencia_conducir"] as const) await documentoPendiente(uno, tipo, `campana-uno-${tipo}`);
    for (const label of ["campana-dos", "campana-tres"]) {
      const emp = await empleadoCompleto(label, cuentas.add);
      await solicitudPendiente(emp, [{ campo: "alergias", valor_propuesto: "Ácaros" }]);
      for (const tipo of ["dni_frente", "dni_dorso", "licencia_conducir"] as const) {
        if (label === "campana-tres" && tipo === "licencia_conducir") continue;
        await documentoPendiente(emp, tipo, `${label}-${tipo}`);
      }
    }
    await page.reload();
    await expect(campana(page).getByTestId("campana-conteo")).toHaveText(copy.campana.tope);
    await expect(campana(page)).toHaveAccessibleName(formatCopy(copy.campana.pendientes, { n: "11" }));
    await expect(page.getByText(formatCopy(copy.aprobaciones.bandeja.total, { n: "11" }), { exact: true })).toBeVisible();
    await screenshotBoth(page, "campana-9-mas");
  } finally {
    await restaurar(apartados);
  }
});
