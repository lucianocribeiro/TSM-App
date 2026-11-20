import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clasificarRuta } from "@/lib/auth/rutas";
import { copy } from "@/lib/copy/es-AR";
import { copyRecibos } from "@/lib/copy/recibos";
import { fakePdf } from "./actores";
import { createTestUser, deleteTestUsers, serviceClient, type TestUser } from "./helpers";
import {
  despejarRetenidos,
  fakePng,
  FIRMAS_BUCKET,
  firmarRecibo,
  nuevaFirma,
  nuevoPeriodo,
  nuevoRecibo,
  RECIBOS_BUCKET,
  subir,
} from "./recibos";

// F2-06: the Estado de firmas loaders and actions against the local stack,
// with each caller's own session (RLS decides). Global counts are compared
// as differences around this file's own rows (integration files run one at
// a time). Own test accounts, invented names; rows that can be removed are
// removed in finally, the rest (evidence, history, overrides and the
// accounts holding them) stay by design (tests/integration/recibos.ts).

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

const estado = await import("@/lib/recibos/estado");
const acciones = await import("@/app/(app)/recibos/estado/actions");

const service = serviceClient();
const noAutorizado = { ok: false, error: copy.cuentas.errors.noAutorizado };
let admin: TestUser;
let conNombre: TestUser;
let sinNombre: TestUser;
let aDesactivar: TestUser;
let sinRecibo: TestUser;
const cuentas: string[] = [];

beforeAll(async () => {
  admin = await createTestUser(service, "estado-admin", "admin");
  conNombre = await createTestUser(service, "estado-con-nombre");
  sinNombre = await createTestUser(service, "estado-sin-nombre");
  aDesactivar = await createTestUser(service, "estado-desactivado");
  sinRecibo = await createTestUser(service, "estado-sin-recibo");
  cuentas.push(admin.id, conNombre.id, sinNombre.id, aDesactivar.id, sinRecibo.id);
  const nombres: [TestUser, string, string][] = [
    [admin, "Admin", "Estado"],
    [conNombre, "Prueba", "Inventada"],
    [aDesactivar, "Baja", "Ficticia"],
    [sinRecibo, "Sin", "Recibo"],
  ];
  for (const [usuario, nombresLegajo, apellido] of nombres) {
    const { error } = await service.from("legajos").update({ nombres: nombresLegajo, apellido }).eq("profile_id", usuario.id);
    if (error) throw new Error(`legajo setup failed: ${error.message}`);
  }
}, 60_000);

afterAll(async () => {
  session.client = null;
  await despejarRetenidos(service, cuentas);
  await deleteTestUsers(service, cuentas);
});

const como = (usuario: TestUser) => {
  session.client = usuario.client;
};

// Removable rows only: receipts without evidence or history, then periods
// with no receipt left.
async function limpiar(recibos: string[], periodos: string[]) {
  if (recibos.length) await service.from("recibos").delete().in("id", recibos);
  for (const periodo of periodos) await service.from("recibo_periodos").delete().eq("id", periodo);
}

// The same definition, straight from the database with the service role.
// Only Empleado owners count (RF-05, decision 1; AUD-06-01).
async function contarConServicio(): Promise<number> {
  const { data, error } = await service
    .from("recibos")
    .select("empleado_id, recibo_periodos!inner(estado), profiles!recibos_empleado_id_fkey!inner(role)")
    .eq("estado", "pendiente")
    .in("recibo_periodos.estado", ["publicado", "cerrado"])
    .eq("profiles.role", "empleado");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((fila) => fila.empleado_id)).size;
}

async function desactivar(usuario: TestUser) {
  const { data } = await service.from("profiles").select("estado_cuenta").eq("id", usuario.id).single();
  if (data?.estado_cuenta === "inactiva") return;
  const { error } = await admin.client.rpc("desactivar_cuenta", { p_profile_id: usuario.id, p_motivo: "Prueba F2-06" });
  if (error) throw new Error(`deactivation failed: ${error.message}`);
}

describe("contarEmpleadosConRecibosSinFirmar (decision 7)", () => {
  it("counts distinct employees with a pending receipt in a published or closed period, deactivated included", async () => {
    const recibos: string[] = [];
    const periodos: string[] = [];
    try {
      como(admin);
      const antes = await estado.contarEmpleadosConRecibosSinFirmar();
      expect(antes).toBe(await contarConServicio());

      const publicado = await nuevoPeriodo(service, admin.id, "publicado");
      const cerrado = await nuevoPeriodo(service, admin.id, "cerrado");
      const borrador = await nuevoPeriodo(service, admin.id, "borrador");
      periodos.push(publicado.id, cerrado.id, borrador.id);
      // Pending in two periods: counts once.
      recibos.push(await nuevoRecibo(service, publicado.id, conNombre.id, admin.id));
      recibos.push(await nuevoRecibo(service, cerrado.id, conNombre.id, admin.id));
      // Pending only in a draft: does not count.
      recibos.push(await nuevoRecibo(service, borrador.id, sinRecibo.id, admin.id));
      // Pending, then the account deactivated: still counts.
      recibos.push(await nuevoRecibo(service, publicado.id, aDesactivar.id, admin.id));
      await desactivar(aDesactivar);
      // Signed only: does not count (kept: its evidence cannot be removed).
      const firmado = await nuevoRecibo(service, publicado.id, sinNombre.id, admin.id);
      await firmarRecibo(service, firmado, sinNombre.id, await nuevaFirma(service, sinNombre.id));

      como(admin);
      const despues = await estado.contarEmpleadosConRecibosSinFirmar();
      expect(despues).toBe((antes ?? 0) + 2);
      expect(despues).toBe(await contarConServicio());
    } finally {
      // The published period keeps the signed receipt (evidence), so its
      // delete is refused (ON DELETE RESTRICT) and it stays.
      await limpiar(recibos, periodos);
    }
  });

  it("is not reachable by an Empleado: the loader refuses, and the route is Admin only", async () => {
    como(sinRecibo);
    await expect(estado.contarEmpleadosConRecibosSinFirmar()).resolves.toBeNull();
    await expect(estado.cargarEstadoPeriodo(randomUUID())).resolves.toBeNull();
    await expect(estado.cargarDetalleRecibo(randomUUID())).resolves.toBeNull();
    expect(clasificarRuta("/recibos/estado")).toBe("admin");
    expect(clasificarRuta("/legajos")).toBe("admin");
  });
});

describe("cargarEstadoPeriodo (decision 6)", () => {
  it("every active Empleado (Sin recibo when none), plus a deactivated account with a receipt, tagged; states and times", async () => {
    const recibos: string[] = [];
    const periodo = await nuevoPeriodo(service, admin.id, "publicado");
    try {
      const pendiente = await nuevoRecibo(service, periodo.id, conNombre.id, admin.id);
      const deBaja = await nuevoRecibo(service, periodo.id, aDesactivar.id, admin.id);
      recibos.push(pendiente, deBaja);
      await desactivar(aDesactivar);
      const firmado = await nuevoRecibo(service, periodo.id, sinNombre.id, admin.id);
      await firmarRecibo(service, firmado, sinNombre.id, await nuevaFirma(service, sinNombre.id));
      const { data: fila } = await service.from("recibos").select("firmado_at, cargado_at").eq("id", firmado).single();

      como(admin);
      const resultado = await estado.cargarEstadoPeriodo(periodo.id);
      expect(resultado).not.toBeNull();
      const filas = resultado!.filas;
      const de = (id: string) => filas.find((f) => f.empleadoId === id);

      expect(de(conNombre.id)).toMatchObject({ nombre: "Prueba Inventada", estado: "pendiente", inactiva: false, reciboId: pendiente, firmadoAt: null });
      expect(de(aDesactivar.id)).toMatchObject({ nombre: "Baja Ficticia", estado: "pendiente", inactiva: true, reciboId: deBaja });
      expect(de(sinNombre.id)).toMatchObject({
        nombre: sinNombre.email,
        estado: "firmado",
        inactiva: false,
        firmadoAt: estado.fechaHoraCorta(fila!.firmado_at),
        cargadoAt: estado.fechaHoraCorta(fila!.cargado_at),
      });
      expect(de(sinRecibo.id)).toMatchObject({ nombre: "Sin Recibo", estado: "sin_recibo", inactiva: false, reciboId: null });

      // Exactly the active Empleados plus the one deactivated account.
      const { count } = await service
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "empleado")
        .eq("estado_cuenta", "activa");
      expect(filas).toHaveLength((count ?? 0) + 1);
      expect(new Set(filas.map((f) => f.empleadoId)).size).toBe(filas.length);
      expect(resultado!.conteos).toEqual(estado.contarEstados(filas));
      expect(resultado!.conteos.firmado).toBe(1);
      expect(resultado!.conteos.pendiente).toBe(2);
      // Never a raw id on screen.
      const ids = new Set(filas.flatMap((f) => [f.empleadoId, f.reciboId]));
      for (const f of filas) expect(ids.has(f.nombre)).toBe(false);
    } finally {
      await limpiar(recibos, []);
    }
  });
});

// A receipt with two replaced files (the first pending, the second signed),
// a DNI override, and the current file signed with the second signature
// version; every file stored. Rows are append-only: kept by design.
async function reciboConHistoria() {
  const periodo = await nuevoPeriodo(service, admin.id, "publicado");
  const ruta = () => `${conNombre.id}/${periodo.id}/${randomUUID()}.pdf`;
  const reciboId = await nuevoRecibo(service, periodo.id, conNombre.id, admin.id);
  const firma1 = await nuevaFirma(service, conNombre.id);
  const primero = { path: ruta(), at: "2026-01-05T12:00:00Z" };
  const segundo = { path: ruta(), at: "2026-01-09T12:00:00Z" };
  const historial = await service
    .from("recibo_historial")
    .insert([
      {
        recibo_id: reciboId,
        periodo_id: periodo.id,
        empleado_id: conNombre.id,
        archivo_path: primero.path,
        archivo_bytes: 512,
        estado_al_reemplazo: "pendiente",
        cargado_por: admin.id,
        cargado_at: "2026-01-01T12:00:00Z",
        reemplazado_por: admin.id,
        reemplazado_at: primero.at,
      },
      {
        recibo_id: reciboId,
        periodo_id: periodo.id,
        empleado_id: conNombre.id,
        archivo_path: segundo.path,
        archivo_bytes: 512,
        estado_al_reemplazo: "firmado",
        firmado_at: "2026-01-07T12:00:00Z",
        firma_id: firma1,
        cargado_por: admin.id,
        cargado_at: primero.at,
        reemplazado_por: sinNombre.id,
        reemplazado_at: segundo.at,
      },
    ])
    .select("id, reemplazado_at");
  if (historial.error || !historial.data) throw new Error(`history setup failed: ${historial.error?.message}`);
  const porFecha = [...historial.data].sort((a, b) => a.reemplazado_at.localeCompare(b.reemplazado_at));
  const { data: actual } = await service.from("recibos").select("archivo_path").eq("id", reciboId).single();
  const override = await service
    .from("recibo_overrides")
    .insert({ recibo_id: reciboId, motivo: "dni_no_encontrado", archivo_path: actual!.archivo_path, admin_id: admin.id })
    .select("id")
    .single();
  if (override.error) throw new Error(`override setup failed: ${override.error.message}`);
  const firma2 = await nuevaFirma(service, conNombre.id);
  await firmarRecibo(service, reciboId, conNombre.id, firma2);
  const { data: firmas } = await service.from("firmas_empleado").select("id, imagen_path").in("id", [firma1, firma2]);

  for (const path of [primero.path, segundo.path, actual!.archivo_path]) await subir(service, RECIBOS_BUCKET, path, fakePdf("estado"), "application/pdf");
  for (const firma of firmas ?? []) await subir(service, FIRMAS_BUCKET, firma.imagen_path, fakePng("estado"), "image/png");
  return { periodo, reciboId, firma2, historial: porFecha.map((h) => h.id), paths: { actual: actual!.archivo_path, primero: primero.path, segundo: segundo.path } };
}

let historia: Awaited<ReturnType<typeof reciboConHistoria>>;

describe("only Empleado receipt owners (RF-05, decision 1; AUD-06-01)", () => {
  it("a pending receipt owned by an Admin is neither a row of the period nor counted on the card", async () => {
    const recibos: string[] = [];
    const periodos: string[] = [];
    try {
      const otroAdmin = await createTestUser(service, "estado-otro-admin", "admin");
      cuentas.push(otroAdmin.id);
      como(admin);
      const antes = await estado.contarEmpleadosConRecibosSinFirmar();
      const { count: yaPendientes } = await service
        .from("recibos")
        .select("id, recibo_periodos!inner(estado)", { count: "exact", head: true })
        .eq("empleado_id", conNombre.id)
        .eq("estado", "pendiente")
        .in("recibo_periodos.estado", ["publicado", "cerrado"]);
      const periodo = await nuevoPeriodo(service, admin.id, "publicado");
      periodos.push(periodo.id);
      // Inserted directly with the service role (recibo_registrar would
      // refuse a non-Empleado owner), next to an Empleado's receipt.
      recibos.push(await nuevoRecibo(service, periodo.id, otroAdmin.id, admin.id));
      recibos.push(await nuevoRecibo(service, periodo.id, conNombre.id, admin.id));

      como(admin);
      const resultado = await estado.cargarEstadoPeriodo(periodo.id);
      expect(resultado).not.toBeNull();
      const ids = resultado!.filas.map((fila) => fila.empleadoId);
      expect(ids).not.toContain(otroAdmin.id);
      expect(ids).not.toContain(admin.id);
      expect(resultado!.filas.find((fila) => fila.empleadoId === conNombre.id)).toMatchObject({ estado: "pendiente" });
      expect(resultado!.conteos.pendiente).toBe(1);

      // The Empleado adds one (unless already counted); the Admin adds none.
      const despues = await estado.contarEmpleadosConRecibosSinFirmar();
      expect(despues).toBe((antes ?? 0) + (yaPendientes ? 0 : 1));
      expect(despues).toBe(await contarConServicio());
      const { data: sinFiltro } = await service
        .from("recibos")
        .select("empleado_id, recibo_periodos!inner(estado)")
        .eq("estado", "pendiente")
        .in("recibo_periodos.estado", ["publicado", "cerrado"]);
      // The Admin's receipt is really there, pending in a visible period.
      expect(new Set((sinFiltro ?? []).map((fila) => fila.empleado_id)).has(otroAdmin.id)).toBe(true);
    } finally {
      // Both receipts have no evidence or history: removed, then the period.
      await limpiar(recibos, periodos);
    }
  });
});

describe("cargarDetalleRecibo (decision 8)", () => {
  beforeAll(async () => {
    historia = await reciboConHistoria();
  }, 60_000);

  it("evidence, overrides and replacements in order, with resolved names and no raw ids", async () => {
    como(admin);
    const detalle = await estado.cargarDetalleRecibo(historia.reciboId);
    expect(detalle).not.toBeNull();
    const { data: evidencia } = await service.from("recibo_firmas").select("firmado_at").eq("recibo_id", historia.reciboId).eq("firma_id", historia.firma2).single();
    expect(detalle).toMatchObject({
      nombre: "Prueba Inventada",
      periodo: { anio: historia.periodo.anio, mes: historia.periodo.mes, estado: "publicado" },
      actual: { estado: "firmado", cargadoPor: "Admin Estado" },
      firma: { version: 2, firmaId: historia.firma2, firmadoAt: estado.fechaHoraCorta(evidencia!.firmado_at) },
      overrides: [{ motivo: "dni_no_encontrado", quien: "Admin Estado" }],
    });
    expect(detalle!.reemplazos.map((r) => [r.numero, r.historialId, r.quien, r.estadoAlReemplazo, r.firmadoAt])).toEqual([
      [2, historia.historial[1], sinNombre.email, "firmado", estado.fechaHoraCorta("2026-01-07T12:00:00Z")],
      [1, historia.historial[0], "Admin Estado", "pendiente", null],
    ]);
    const mostrado = JSON.stringify([detalle!.nombre, detalle!.actual, detalle!.overrides.map((o) => [o.quien, o.cuando]), detalle!.reemplazos.map((r) => [r.quien, r.cuando])]);
    for (const id of cuentas) expect(mostrado).not.toContain(id);
  });

  it("an unknown receipt id gives null", async () => {
    como(admin);
    await expect(estado.cargarDetalleRecibo(randomUUID())).resolves.toBeNull();
  });
});

describe("obtenerUrlArchivoReciboAdmin and obtenerUrlFirmaAdmin", () => {
  const archivoDe = (url: string) => decodeURIComponent(new URL(url).pathname.split("/object/sign/")[1] ?? "");

  it("an Admin gets 5-minute links to the current file, each replaced file and the signature image", async () => {
    como(admin);
    const apellido = "Inventada";
    const mmaaaa = `${String(historia.periodo.mes).padStart(2, "0")}-${historia.periodo.anio}`;

    const ver = await acciones.obtenerUrlArchivoReciboAdmin({ origen: "actual", id: historia.reciboId, modo: "ver" });
    expect(ver.ok).toBe(true);
    expect(archivoDe(ver.ok ? ver.data!.url : "")).toBe(`${RECIBOS_BUCKET}/${historia.paths.actual}`);
    expect(new URL(ver.ok ? ver.data!.url : "http://x").searchParams.has("download")).toBe(false);

    const actual = await acciones.obtenerUrlArchivoReciboAdmin({ origen: "actual", id: historia.reciboId, modo: "descargar" });
    expect(actual.ok && new URL(actual.data!.url).searchParams.get("download")).toBe(`Recibo-${apellido}-${mmaaaa}.pdf`);
    const respuesta = await fetch(actual.ok ? actual.data!.url : "");
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-disposition") ?? "").toContain(`Recibo-${apellido}-${mmaaaa}.pdf`);

    for (const [i, path] of [historia.paths.primero, historia.paths.segundo].entries()) {
      const r = await acciones.obtenerUrlArchivoReciboAdmin({ origen: "historial", id: historia.historial[i], modo: "descargar" });
      expect(r.ok).toBe(true);
      const url = r.ok ? r.data!.url : "";
      expect(archivoDe(url)).toBe(`${RECIBOS_BUCKET}/${path}`);
      expect(new URL(url).searchParams.get("download")).toBe(`Recibo-${apellido}-${mmaaaa}-reemplazado-${i + 1}.pdf`);
      expect((await fetch(url)).status).toBe(200);
    }

    const firma = await acciones.obtenerUrlFirmaAdmin({ firmaId: historia.firma2 });
    expect(firma.ok).toBe(true);
    const { data: imagen } = await service.from("firmas_empleado").select("imagen_path").eq("id", historia.firma2).single();
    expect(archivoDe(firma.ok ? firma.data!.url : "")).toBe(`${FIRMAS_BUCKET}/${imagen!.imagen_path}`);
    expect((await fetch(firma.ok ? firma.data!.url : "")).status).toBe(200);
  });

  it("an unknown id or a receipt id used as a history id gives the controlled error", async () => {
    como(admin);
    const e = copyRecibos.estado.errors;
    await expect(acciones.obtenerUrlArchivoReciboAdmin({ origen: "historial", id: historia.reciboId, modo: "ver" })).resolves.toEqual({ ok: false, error: e.verFallo });
    await expect(acciones.obtenerUrlArchivoReciboAdmin({ origen: "actual", id: randomUUID(), modo: "ver" })).resolves.toEqual({ ok: false, error: e.verFallo });
    await expect(acciones.obtenerUrlFirmaAdmin({ firmaId: randomUUID() })).resolves.toEqual({ ok: false, error: e.firmaFallo });
  });

  it("an Empleado, even the receipt's own, is refused by both", async () => {
    como(conNombre);
    await expect(acciones.obtenerUrlArchivoReciboAdmin({ origen: "actual", id: historia.reciboId, modo: "ver" })).resolves.toEqual(noAutorizado);
    await expect(acciones.obtenerUrlArchivoReciboAdmin({ origen: "historial", id: historia.historial[0], modo: "descargar" })).resolves.toEqual(noAutorizado);
    await expect(acciones.obtenerUrlFirmaAdmin({ firmaId: historia.firma2 })).resolves.toEqual(noAutorizado);
  });
});
