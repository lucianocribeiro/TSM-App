import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { fechaDeSerial, leerXlsx } from "../../e2e/xlsx";
import { legajoIdDe } from "./actores";
import { createTestUser, deleteTestUsers, serviceClient, type TestUser } from "./helpers";
import { escribirLaboral, itemId, laboralCompleto } from "./laborales";

// CR-4: the Excel export of the Legajos list against the local stack. The
// session-bound server client is the signed-in test user's client, so RLS
// and registrar_exportacion decide as in the app. Each run's employees share
// a unique apellido, so the search scopes the export to them.
const session = vi.hoisted(() => ({
  client: null as unknown,
  user: null as null | { id: string; email: string; role: "empleado" | "admin"; cuenta: unknown },
  // Bytes of a synthetic workbook in place of the real one (size cap).
  bytes: null as number | null,
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("@/lib/exportacion/xlsx", async (original) => {
  const real = await original<typeof import("@/lib/exportacion/xlsx")>();
  return {
    escribirXlsx: async (...args: Parameters<typeof real.escribirXlsx>) =>
      session.bytes === null ? real.escribirXlsx(...args) : Buffer.alloc(session.bytes),
  };
});
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));

const legajos = await import("@/app/(app)/legajos/actions");
const { MAX_CONTENIDO_BASE64 } = await import("@/lib/exportacion/exportar");

const ACTIVA = { estadoCuenta: "activa", debeCambiarPassword: false };
const noAutorizado = { ok: false, error: copy.cuentas.errors.noAutorizado };
const errors = copy.exportacion.errors;
const MARCA = `Exporta${randomUUID().slice(0, 8)}`;
const FILTROS = { busqueda: MARCA, estadoLaboral: "", areaId: "", sucursalId: "", tareaId: "", mostrarBajas: false };

describe("Excel export (CR-4)", () => {
  const service = serviceClient();
  let admin: TestUser;
  let otroAdmin: TestUser;
  let ana: TestUser;
  let beto: TestUser;
  let baja: TestUser;

  function as(user: TestUser, role: "empleado" | "admin", client: unknown = user.client) {
    session.client = client;
    session.user = { id: user.id, email: user.email, role, cuenta: ACTIVA };
  }

  async function logDe(actorId: string) {
    const { data, error } = await service
      .from("exportaciones")
      .select("actor_id, campos, incluye_hijos, cantidad, filtros, resultado")
      .eq("actor_id", actorId)
      .order("secuencia");
    expect(error).toBeNull();
    return data ?? [];
  }

  async function empleado(label: string, nombres: string, extra: { hijos?: string[]; area?: string } = {}) {
    const user = await createTestUser(service, label);
    const legajoId = await legajoIdDe(service, user.id);
    const { error } = await service
      .from("legajos")
      .update({ nombres, apellido: MARCA, fecha_nacimiento: "1990-01-15", tiene_hijos: Boolean(extra.hijos?.length) })
      .eq("id", legajoId);
    expect(error).toBeNull();
    const laboral = await laboralCompleto(service, `X-${nombres}`);
    if (extra.area) {
      laboral.area_id = await itemId(service, "area", extra.area);
      laboral.puesto_id = (await service.from("catalogo_items").select("id").eq("area_id", laboral.area_id).limit(1).single()).data!.id;
    }
    await escribirLaboral(service, legajoId, laboral);
    for (const [i, hijo] of (extra.hijos ?? []).entries()) {
      expect((await service.from("legajo_hijos").insert({ legajo_id: legajoId, nombre_completo: hijo, fecha_nacimiento: `201${i}-05-05` })).error).toBeNull();
    }
    return user;
  }

  async function exportar(input: unknown) {
    const result = await legajos.exportarLegajos(input);
    if (!result.ok || !result.data) return { result, libro: null };
    return { result, libro: leerXlsx(Buffer.from(result.data.contenido, "base64")) };
  }

  beforeAll(async () => {
    admin = await createTestUser(service, "exporta-admin", "admin");
    otroAdmin = await createTestUser(service, "exporta-admin-2", "admin");
    ana = await empleado("exporta-ana", "Ana", { hijos: ["Hija Uno", "=Hijo Dos"] });
    beto = await empleado("exporta-beto", "Beto", { area: "Logística" });
    baja = await empleado("exporta-baja", "Carla");
    expect((await admin.client.rpc("desactivar_cuenta", { p_profile_id: baja.id, p_motivo: "Baja (prueba)" })).error).toBeNull();
  }, 90_000);

  afterAll(async () => {
    session.client = null;
    session.user = null;
    await service.from("exportaciones").delete().in("actor_id", [admin.id, otroAdmin.id]);
    await deleteTestUsers(service, [ana.id, beto.id, baja.id, admin.id, otroAdmin.id]);
  });

  it("exports the employees the list shows, with the chosen fields, and logs it", async () => {
    as(admin, "admin");
    const seleccion = { campos: ["numero_legajo", "nombres", "apellido", "fecha_nacimiento", "area"], hijos: false };
    const { result, libro } = await exportar({ filtros: FILTROS, seleccion });
    expect(result.ok && result.data?.nombre).toMatch(/^legajos-\d{4}-\d{2}-\d{2}-\d{4}\.xlsx$/);
    expect(libro!.hojas.map((h) => h.nombre)).toEqual(["Legajos"]);
    const [encabezado, ...filas] = libro!.hojas[0].filas;
    expect(encabezado.map((c) => c.texto)).toEqual(["Nombres", "Apellido", "Fecha de nacimiento", "Número de legajo", "Área"]);
    // Active only, ordered as the list (apellido, then name).
    expect(filas.map((f) => f[0].texto)).toEqual(["Ana", "Beto"]);
    expect(fechaDeSerial(filas[0][2].numero!)).toBe("1990-01-15");
    expect(filas[1][4].texto).toBe("Logística");

    expect(await logDe(admin.id)).toEqual([
      {
        actor_id: admin.id,
        campos: ["nombres", "apellido", "fecha_nacimiento", "numero_legajo", "area"],
        incluye_hijos: false,
        cantidad: 2,
        filtros: FILTROS,
        resultado: "ok",
      },
    ]);
  });

  it("includes deactivated employees only with Mostrar dados de baja, and the children as a sheet", async () => {
    as(admin, "admin");
    const filtros = { ...FILTROS, mostrarBajas: true };
    const { libro } = await exportar({ filtros, seleccion: { campos: ["nombres"], hijos: true } });
    expect(libro!.hojas[0].filas.slice(1).map((f) => f[0].texto)).toEqual(["Ana", "Beto", "Carla"]);
    const hijos = libro!.hojas[1];
    expect(hijos.nombre).toBe("Hijos");
    // One row per child, linked by número de legajo, apellido and nombres;
    // text that would be a formula is kept as text.
    const filasHijos = hijos.filas.slice(1);
    expect(filasHijos.map((f) => [f[1].texto, f[2].texto, f[3].texto])).toEqual([
      [MARCA, "Ana", "Hija Uno"],
      [MARCA, "Ana", "'=Hijo Dos"],
    ]);
    expect(filasHijos.every((f) => /^X-Ana-/.test(f[0].texto ?? ""))).toBe(true);
    expect((await logDe(admin.id)).at(-1)).toMatchObject({ cantidad: 3, incluye_hijos: true, filtros });
  });

  it("applies the list filters on the server", async () => {
    as(admin, "admin");
    const logistica = await itemId(service, "area", "Logística");
    const { libro } = await exportar({ filtros: { ...FILTROS, areaId: logistica }, seleccion: { campos: ["nombres"], hijos: false } });
    expect(libro!.hojas[0].filas.slice(1).map((f) => f[0].texto)).toEqual(["Beto"]);
  });

  it("refuses an unknown field key or list state, and an empty result, logging nothing", async () => {
    as(admin, "admin");
    const antes = await logDe(admin.id);
    for (const input of [
      { filtros: FILTROS, seleccion: { campos: ["nombres", "profile_id"], hijos: false } },
      { filtros: { ...FILTROS, filas: [{ nombres: "inyectado" }] }, seleccion: { campos: ["nombres"], hijos: false } },
      { filtros: FILTROS, seleccion: { campos: ["nombres"], hijos: false }, filas: [{ nombres: "inyectado" }] },
      { filtros: FILTROS, seleccion: { campos: ["nombres"], hijos: false, extra: true } },
    ]) {
      expect((await exportar(input)).result).toEqual({ ok: false, error: errors.seleccion });
    }
    expect((await exportar({ filtros: { ...FILTROS, busqueda: `${MARCA}-nadie` }, seleccion: { campos: ["nombres"], hijos: false } })).result).toEqual({
      ok: false,
      error: errors.sinEmpleados,
    });
    expect(await logDe(admin.id)).toEqual(antes);
  });

  it("refuses the export when the log cannot be written: no file, no row", async () => {
    // The real function, made to fail: a malformed record (22023).
    const client = admin.client;
    const roto = new Proxy(client, {
      get(target, prop, receiver) {
        if (prop === "rpc") {
          return (nombre: "registrar_exportacion", args: Record<string, unknown>) =>
            target.rpc(nombre, { ...args, p_resultado: "quizas" } as never);
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    as(admin, "admin", roto);
    const antes = await logDe(admin.id);
    expect((await exportar({ filtros: FILTROS, seleccion: { campos: ["nombres"], hijos: false } })).result).toEqual({ ok: false, error: errors.fallo });
    expect(await logDe(admin.id)).toEqual(antes);
  });

  it("refuses a file over the response size cap: the message, no file, an 'error' row", async () => {
    as(admin, "admin");
    const antes = (await logDe(admin.id)).length;
    session.bytes = (MAX_CONTENIDO_BASE64 / 4) * 3 + 1;
    try {
      const { result } = await exportar({ filtros: FILTROS, seleccion: { campos: ["nombres", "area"], hijos: true } });
      expect(result).toEqual({ ok: false, error: errors.demasiadoGrande });
    } finally {
      session.bytes = null;
    }
    const filas = await logDe(admin.id);
    expect(filas).toHaveLength(antes + 1);
    expect(filas.at(-1)).toMatchObject({ resultado: "error", campos: ["nombres", "area"], incluye_hijos: true, cantidad: 2 });
  });

  it("an Empleado or no session gets no file and logs nothing", async () => {
    const input = { filtros: { ...FILTROS, mostrarBajas: true }, seleccion: { campos: ["nombres"], hijos: true } };
    as(ana, "empleado");
    expect((await exportar(input)).result).toEqual(noAutorizado);
    session.user = null;
    expect((await exportar(input)).result).toEqual(noAutorizado);
    expect(await logDe(ana.id)).toEqual([]);
    // The database refuses the log to an Empleado too.
    expect((await ana.client.rpc("registrar_exportacion", { p_campos: ["nombres"], p_incluye_hijos: false, p_cantidad: 1, p_filtros: {}, p_resultado: "ok" })).error?.code).toBe("42501");
  });

  it("the log: written only by the function, as the caller, with its checks", async () => {
    const valido = { p_campos: ["nombres"], p_incluye_hijos: false, p_cantidad: 1, p_filtros: {}, p_resultado: "ok" };
    for (const malo of [
      { p_campos: [] },
      { p_campos: ["nombres", "nombres"] },
      { p_campos: ["Nombres; drop"] },
      { p_cantidad: -1 },
      { p_filtros: [] },
      { p_resultado: "quizas" },
    ]) {
      expect((await otroAdmin.client.rpc("registrar_exportacion", { ...valido, ...(malo as object) } as never)).error?.code, JSON.stringify(malo)).toBe("22023");
    }
    const { error } = await otroAdmin.client.rpc("registrar_exportacion", valido);
    expect(error).toBeNull();
    const [fila] = await logDe(otroAdmin.id);
    expect(fila).toMatchObject({ actor_id: otroAdmin.id, campos: ["nombres"], cantidad: 1, resultado: "ok" });

    // No direct writes, even for an Admin.
    const directo = await otroAdmin.client
      .from("exportaciones")
      .insert({ actor_id: otroAdmin.id, campos: ["nombres"], incluye_hijos: false, cantidad: 1, filtros: {}, resultado: "ok" });
    expect(directo.error?.code).toBe("42501");
    expect((await otroAdmin.client.from("exportaciones").update({ cantidad: 5 }).eq("actor_id", otroAdmin.id).select("id")).error?.code).toBe("42501");
    expect((await otroAdmin.client.from("exportaciones").delete().eq("actor_id", otroAdmin.id).select("id")).error?.code).toBe("42501");
    expect(await logDe(otroAdmin.id)).toHaveLength(1);
  });

  it("an Admin named in the log cannot be purged, as in the Configuración history; the log survives deactivation", async () => {
    expect((await admin.client.rpc("desactivar_cuenta", { p_profile_id: otroAdmin.id, p_motivo: "Baja (prueba)" })).error).toBeNull();
    const purga = await admin.client.rpc("purgar_cuenta", { p_profile_id: otroAdmin.id, p_email_confirmacion: otroAdmin.email });
    expect(purga.error?.code).toBe("55000");
    expect(purga.error?.hint).toBe("historial_otras_cuentas");
    expect(await logDe(otroAdmin.id)).toHaveLength(1);
    // The history view (Admin only) still reads it.
    expect(((await admin.client.from("exportaciones").select("id").eq("actor_id", otroAdmin.id)).data ?? []).length).toBe(1);
  });
});
