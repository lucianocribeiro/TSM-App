import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { laboralRow, legajoRow } from "./fixtures.test-helpers";

// The export service with the database replaced by a double: the rows are
// read again on the server and filtered with the list's rules; the file is
// returned only once the export is logged; nothing personal reaches the
// server log.

const state = vi.hoisted(() => ({
  filas: [] as unknown[],
  rpc: null as unknown as Mock<(...args: unknown[]) => Promise<unknown>>,
  // Bytes of a synthetic workbook, in place of the real one (size cap tests).
  bytes: null as number | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("./xlsx", async (original) => {
  const real = await original<typeof import("./xlsx")>();
  return {
    escribirXlsx: async (...args: Parameters<typeof real.escribirXlsx>) =>
      state.bytes === null ? real.escribirXlsx(...args) : Buffer.alloc(state.bytes),
  };
});
vi.mock("@/lib/configuracion/datos", () => ({ listarItems: async () => [] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: async () => ({ data: state.filas, error: null }) }),
    rpc: (...args: unknown[]) => state.rpc(...args),
  }),
}));

const { excedeTamano, exportarLegajos, MAX_CONTENIDO_BASE64 } = await import("./exportar");
const errors = copy.exportacion.errors;
const FILTROS = { busqueda: "", estadoLaboral: "", areaId: "", sucursalId: "", tareaId: "", mostrarBajas: false };
const SELECCION = { campos: ["numero_legajo", "nombres"], hijos: true };

function fila(n: number, apellido: string, estadoCuenta: "activa" | "inactiva") {
  const id = `10000000-0000-4000-8000-00000000000${n}`;
  return {
    ...legajoRow({ id, profile_id: `20000000-0000-4000-8000-00000000000${n}`, apellido }),
    legajos_laborales: laboralRow({ legajo_id: id, numero_legajo: `L-${n}` }),
    profiles: { estado_cuenta: estadoCuenta },
    legajo_hijos: [{ nombre_completo: "Hijo", fecha_nacimiento: "2015-01-01" }],
  };
}

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  state.filas = [fila(1, "Zeta", "activa"), fila(2, "Alfa", "activa"), fila(3, "Baja", "inactiva")];
  state.rpc = vi.fn(async () => ({ data: "id", error: null }));
  state.bytes = null;
  log = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => log.mockRestore());

describe("exportarLegajos", () => {
  it("exports the employees the list shows, logs it, then returns the file", async () => {
    const result = await exportarLegajos({ filtros: FILTROS, seleccion: SELECCION }, new Date("2026-10-11T15:05:00Z"));
    expect(result.ok && result.data?.nombre).toBe("legajos-2026-10-11-1205.xlsx");
    expect(result.ok && Buffer.from(result.data!.contenido, "base64").subarray(0, 2).toString()).toBe("PK");
    expect(state.rpc).toHaveBeenCalledWith("registrar_exportacion", {
      p_campos: ["nombres", "numero_legajo"],
      p_incluye_hijos: true,
      p_cantidad: 2,
      p_filtros: FILTROS,
      p_resultado: "ok",
    });
  });

  it("includes deactivated employees only with Mostrar dados de baja", async () => {
    await exportarLegajos({ filtros: { ...FILTROS, mostrarBajas: true }, seleccion: SELECCION });
    expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_cantidad: 3 });
  });

  it("refuses the export when it cannot be logged: no file", async () => {
    state.rpc = vi.fn(async () => ({ data: null, error: { code: "42501", message: "x" } }));
    expect(await exportarLegajos({ filtros: FILTROS, seleccion: SELECCION })).toEqual({ ok: false, error: errors.fallo });
  });

  it("refuses unknown field keys or list state before reading anything", async () => {
    for (const input of [
      { filtros: FILTROS, seleccion: { campos: ["nombres", "x"], hijos: false } },
      { filtros: { ...FILTROS, extra: true }, seleccion: SELECCION },
      { filtros: FILTROS },
      { filtros: FILTROS, seleccion: SELECCION, filas: [{ nombres: "inyectado" }] },
      { filtros: FILTROS, seleccion: { ...SELECCION, extra: true } },
      [FILTROS, SELECCION],
      null,
    ]) {
      expect(await exportarLegajos(input)).toEqual({ ok: false, error: errors.seleccion });
    }
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("says so when no employee matches, and logs nothing", async () => {
    expect(await exportarLegajos({ filtros: { ...FILTROS, busqueda: "nadie" }, seleccion: SELECCION })).toEqual({
      ok: false,
      error: errors.sinEmpleados,
    });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("logs no personal data", async () => {
    state.rpc = vi.fn(async () => ({ data: null, error: { message: "Zeta L-1 pérez" } }));
    await exportarLegajos({ filtros: { ...FILTROS, busqueda: "zeta" }, seleccion: SELECCION });
    const escrito = log.mock.calls.map((call: unknown[]) => call.join(" ")).join("\n");
    expect(escrito).toContain("export log failed");
    for (const dato of ["Zeta", "zeta", "L-1", "Ana", "pérez"]) expect(escrito).not.toContain(dato);
  });

  it("accepts exactly { filtros, seleccion } unchanged", async () => {
    const result = await exportarLegajos({ filtros: FILTROS, seleccion: SELECCION });
    expect(result.ok).toBe(true);
  });
});

describe("response size cap", () => {
  it("is a base64 length safely below Vercel's 4.5 MB response limit", () => {
    expect(MAX_CONTENIDO_BASE64).toBeLessThanOrEqual(3.5 * 1000 * 1000);
    expect(excedeTamano("A".repeat(MAX_CONTENIDO_BASE64))).toBe(false);
    expect(excedeTamano("A".repeat(MAX_CONTENIDO_BASE64 + 1))).toBe(true);
  });

  // base64 of n bytes is 4 * ceil(n / 3) characters: 2,625,000 bytes are
  // exactly the cap, one byte more goes over it.
  it("returns a file just below the cap", async () => {
    state.bytes = (MAX_CONTENIDO_BASE64 / 4) * 3;
    const result = await exportarLegajos({ filtros: FILTROS, seleccion: SELECCION });
    expect(result.ok && result.data!.contenido.length).toBe(MAX_CONTENIDO_BASE64);
    expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_resultado: "ok" });
  });

  it("refuses a file just above the cap: the message, no file, an 'error' row with the real count and fields", async () => {
    state.bytes = (MAX_CONTENIDO_BASE64 / 4) * 3 + 1;
    expect(await exportarLegajos({ filtros: FILTROS, seleccion: SELECCION })).toEqual({ ok: false, error: errors.demasiadoGrande });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith("registrar_exportacion", {
      p_campos: ["nombres", "numero_legajo"],
      p_incluye_hijos: true,
      p_cantidad: 2,
      p_filtros: FILTROS,
      p_resultado: "error",
    });
  });

  it("still refuses an oversized file when even its log fails", async () => {
    state.bytes = MAX_CONTENIDO_BASE64;
    state.rpc = vi.fn(async () => ({ data: null, error: { message: "x" } }));
    expect(await exportarLegajos({ filtros: FILTROS, seleccion: SELECCION })).toEqual({ ok: false, error: errors.demasiadoGrande });
  });
});
