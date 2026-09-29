import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../src/lib/copy/es-AR";
import { formatCopy } from "../src/lib/copy/format";
import {
  adminNuevo,
  BUCKET,
  documentoPendiente,
  empleadoCompleto,
  haceHoras,
  legajoDe,
  pdf,
  registro,
  sesionDe,
  solicitudPendiente,
} from "./datos";
import { loginAs } from "./helpers";
import { localServiceClient, seedAdminClient } from "./service";

// F1-11B, GAP-06: the approvals inbox. Order across requests and documents,
// a deactivated employee's item, an own-account item, and re-validation on
// approval. Other tests add items in parallel, so each test looks only at the
// rows of its own employees (unique apellidos). The bell counts, which are
// global, run on their own after every other test: campana.serial.spec.ts.
// "Already decided in another tab" is covered in aprobaciones.spec.ts ("an
// item decided in another tab gets a controlled message").

const t = copy.aprobaciones;
const cuentas = registro();
test.afterAll(cuentas.limpiar);

const filas = (page: Page, apellidos: string[]) =>
  page.getByTestId("bandeja-item").filter({ hasText: new RegExp(apellidos.join("|")) });

test("the inbox lists requests and documents together, oldest first", async ({ page }) => {
  const uno = await empleadoCompleto("orden-uno", cuentas.add);
  const dos = await empleadoCompleto("orden-dos", cuentas.add);
  // Interleaved submission times, created out of order.
  const creados = [
    { quien: dos, clase: "documento", creado: (await documentoPendiente(dos, "dni_dorso", "orden-d2", haceHoras(47))).created_at },
    { quien: uno, clase: "solicitud", creado: (await solicitudPendiente(uno, [{ campo: "alergias", valor_propuesto: "Polen" }], haceHoras(48))).created_at },
    { quien: uno, clase: "documento", creado: (await documentoPendiente(uno, "dni_frente", "orden-d1", haceHoras(50))).created_at },
    { quien: dos, clase: "solicitud", creado: (await solicitudPendiente(dos, [{ campo: "alergias", valor_propuesto: "Ácaros" }], haceHoras(49))).created_at },
  ];
  const esperado = [...creados]
    .sort((a, b) => new Date(a.creado).getTime() - new Date(b.creado).getTime())
    .map((item) => `${item.quien.apellido}:${item.clase}`);
  expect(esperado).toEqual([`${uno.apellido}:documento`, `${dos.apellido}:solicitud`, `${uno.apellido}:solicitud`, `${dos.apellido}:documento`]);

  await loginAs(page, await adminNuevo("orden-admin", cuentas.add));
  await page.goto("/aprobaciones");
  const lista = filas(page, [uno.apellido, dos.apellido]);
  await expect(lista).toHaveCount(4);
  const mostrado = await lista.evaluateAll((rows, apellidos) =>
    rows.map((row) => `${apellidos.find((a) => row.textContent?.includes(a))}:${row.getAttribute("data-clase")}`),
  [uno.apellido, dos.apellido]);
  expect(mostrado).toEqual(esperado);
});

test("a deactivated employee's pending item is marked, explained, and can still be rejected", async ({ page }) => {
  const emp = await empleadoCompleto("baja", cuentas.add);
  const solicitud = await solicitudPendiente(emp, [{ campo: "alergias", valor_propuesto: "Gluten" }]);
  const desactivada = await (await seedAdminClient()).rpc("desactivar_cuenta", { p_profile_id: emp.id, p_motivo: "Prueba e2e" });
  expect(desactivada.error).toBeNull();

  await loginAs(page, await adminNuevo("baja-admin", cuentas.add));
  await page.goto("/aprobaciones");
  const fila = filas(page, [emp.apellido]);
  await expect(fila).toHaveCount(1);
  await expect(fila).toHaveAttribute("data-baja", "true");
  await expect(fila).toContainText(t.bandeja.dadoDeBaja);

  await fila.getByRole("link", { name: t.bandeja.revisar }).click();
  await expect(page).toHaveURL(new RegExp(`/aprobaciones/solicitudes/${solicitud.id}$`));
  await expect(page.getByText(t.detalle.cuentaInactiva, { exact: true })).toBeVisible();
  await page.getByTestId("decision").getByRole("button", { name: t.detalle.rechazar }).click();
  const dialog = page.getByRole("dialog", { name: t.detalle.rechazarTitle });
  await dialog.getByLabel(t.motivoRechazoLabel, { exact: true }).fill("La cuenta está dada de baja.");
  await dialog.getByRole("button", { name: t.detalle.confirmarRechazo }).click();
  await expect(page).toHaveURL(/\/aprobaciones\?resultado=solicitudRechazada$/);

  const { data } = await localServiceClient().from("solicitudes_cambio").select("estado, motivo_rechazo").eq("id", solicitud.id).single();
  expect(data).toEqual({ estado: "rechazada", motivo_rechazo: "La cuenta está dada de baja." });
});

test("an Admin's own items, sent while still an Empleado, show no decision buttons", async ({ page }) => {
  const usuario = await empleadoCompleto("propio", cuentas.add);
  // As the Empleado, through the API: a change request and a document upload.
  const sesion = await sesionDe(usuario);
  const creada = await sesion.rpc("crear_solicitud", {
    p_legajo_id: usuario.legajoId,
    p_items: [{ campo: "alergias", valor_propuesto: "Propia" }],
  });
  expect(creada.error).toBeNull();
  const path = `${usuario.id}/dni_frente/${randomUUID()}.pdf`;
  const archivo = pdf("propio");
  expect((await sesion.storage.from(BUCKET).upload(path, archivo.buffer, { contentType: "application/pdf" })).error).toBeNull();
  const subido = await sesion
    .from("legajo_documentos")
    .insert({
      legajo_id: usuario.legajoId,
      tipo: "dni_frente",
      storage_path: path,
      file_name: archivo.name,
      mime_type: "application/pdf",
      size_bytes: archivo.buffer.length,
      uploaded_by: usuario.id,
    })
    .select("id, estado")
    .single();
  expect(subido.data?.estado).toBe("pendiente");
  await sesion.auth.signOut();
  // Then promoted.
  expect((await localServiceClient().from("profiles").update({ role: "admin" }).eq("id", usuario.id)).error).toBeNull();

  await loginAs(page, usuario);
  await page.goto("/aprobaciones");
  const propias = filas(page, [usuario.apellido]);
  await expect(propias).toHaveCount(2);
  for (const fila of await propias.all()) await expect(fila).toContainText(t.bandeja.propio);

  for (const ruta of [`/aprobaciones/solicitudes/${creada.data}`, `/aprobaciones/documentos/${subido.data!.id}`]) {
    await page.goto(ruta);
    await expect(page.getByTestId("banner-propio"), ruta).toHaveText(t.detalle.propio);
    await expect(page.getByTestId("decision"), ruta).toHaveCount(0);
    await expect(page.getByRole("button", { name: t.detalle.aprobar }), ruta).toHaveCount(0);
    await expect(page.getByRole("button", { name: t.detalle.rechazar }), ruta).toHaveCount(0);
  }
  const service = localServiceClient();
  expect((await service.from("solicitudes_cambio").select("estado").eq("id", creada.data!).single()).data?.estado).toBe("pendiente");
  expect((await service.from("legajo_documentos").select("estado").eq("id", subido.data!.id).single()).data?.estado).toBe("pendiente");
});

test("a request whose value no longer validates is refused on approval; the legajo is unchanged", async ({ page }) => {
  const emp = await empleadoCompleto("revalidacion", cuentas.add);
  // Stored as crear_solicitud would (the database does not check the CUIL
  // prefix); the current rules allow only 20, 23, 24 and 27.
  const solicitud = await solicitudPendiente(emp, [{ campo: "cuil", valor_propuesto: `30-${emp.dni}-1` }]);
  const antes = await legajoDe(emp.id);

  await loginAs(page, await adminNuevo("revalidacion-admin", cuentas.add));
  await page.goto(`/aprobaciones/solicitudes/${solicitud.id}`);
  await page.getByTestId("decision").getByRole("button", { name: t.detalle.aprobar }).click();
  await expect(page.getByTestId("decision-error")).toHaveText(formatCopy(t.errors.revalidacion, { campos: t.campos.cuil }));
  await expect(page).toHaveURL(new RegExp(`/aprobaciones/solicitudes/${solicitud.id}$`));

  expect(await legajoDe(emp.id)).toEqual(antes);
  const { data } = await localServiceClient().from("solicitudes_cambio").select("estado").eq("id", solicitud.id).single();
  expect(data?.estado).toBe("pendiente");
});
