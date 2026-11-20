import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyRecibos } from "@/lib/copy/recibos";

// Estado de firmas (F2-06): the pure mapping, counts, display names and the
// download name, and the loaders' own Admin check (refused before any read).

const mocks = vi.hoisted(() => ({
  admin: true,
  createClient: vi.fn(),
  listarCuentas: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-role", () => ({
  sessionWithRole: async () => (mocks.admin ? { id: "admin" } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: (...args: unknown[]) => mocks.createClient(...args) }));
vi.mock("@/lib/admin/cuentas", () => ({ listarCuentas: (...args: unknown[]) => mocks.listarCuentas(...args) }));

const estado = await import("./estado");
const {
  armarDetalle,
  armarFilas,
  contarEstados,
  estadoFirmaDe,
  fechaHoraCorta,
  mapaDeNombres,
  nombreArchivoRecibo,
  parteAscii,
} = estado;

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ADMIN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SIN_DATOS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const persona = (id: string, nombres: string | null, apellido: string | null, email: string | null = null) => ({ id, nombres, apellido, email });

beforeEach(() => {
  mocks.admin = true;
  mocks.createClient.mockReset();
  mocks.listarCuentas.mockReset();
});

describe("fechaHoraCorta", () => {
  it("is dd/mm/aaaa HH:mm in Argentina time", () => {
    expect(fechaHoraCorta("2026-11-20T03:05:00Z")).toBe("20/11/2026 00:05");
    expect(fechaHoraCorta("2026-01-01T02:59:00.000Z")).toBe("31/12/2025 23:59");
  });
  it("keeps null and refuses a bad date", () => {
    expect(fechaHoraCorta(null)).toBeNull();
    expect(fechaHoraCorta("no es una fecha")).toBeNull();
  });
});

describe("states and counts", () => {
  it("maps a receipt to its state", () => {
    expect(estadoFirmaDe(undefined)).toBe("sin_recibo");
    expect(estadoFirmaDe({ estado: "pendiente" })).toBe("pendiente");
    expect(estadoFirmaDe({ estado: "firmado" })).toBe("firmado");
  });
  it("counts every state, zero included", () => {
    expect(contarEstados([])).toEqual({ firmado: 0, pendiente: 0, sin_recibo: 0 });
    expect(contarEstados([{ estado: "firmado" }, { estado: "pendiente" }, { estado: "pendiente" }])).toEqual({
      firmado: 1,
      pendiente: 2,
      sin_recibo: 0,
    });
  });
});

describe("download name", () => {
  it("is Recibo-{Apellido}-{MM}-{AAAA}.pdf, ASCII only", () => {
    expect(nombreArchivoRecibo({ apellido: "Gómez", mes: 3, anio: 2026 })).toBe("Recibo-Gomez-03-2026.pdf");
    expect(nombreArchivoRecibo({ apellido: "Muñoz D'Alessandro", mes: 11, anio: 2026 })).toBe("Recibo-Munoz-D-Alessandro-11-2026.pdf");
    expect(nombreArchivoRecibo({ apellido: '  "Pérez/../x"  ', mes: 1, anio: 2027 })).toBe("Recibo-Perez-x-01-2027.pdf");
    for (const nombre of [nombreArchivoRecibo({ apellido: "Ñandú 漢字 €", mes: 12, anio: 2026 })]) {
      expect(nombre).toMatch(/^[A-Za-z0-9-]+\.pdf$/);
      expect(nombre).toBe("Recibo-Nandu-12-2026.pdf");
    }
  });
  it("drops a missing surname and suffixes a replaced file with its number", () => {
    expect(nombreArchivoRecibo({ apellido: null, mes: 5, anio: 2026 })).toBe("Recibo-05-2026.pdf");
    expect(nombreArchivoRecibo({ apellido: "   ", mes: 5, anio: 2026 })).toBe("Recibo-05-2026.pdf");
    expect(nombreArchivoRecibo({ apellido: "Gómez", mes: 5, anio: 2026, reemplazo: 2 })).toBe("Recibo-Gomez-05-2026-reemplazado-2.pdf");
  });
  it("parteAscii keeps letters and digits only", () => {
    expect(parteAscii("Ávila-Núñez  2")).toBe("Avila-Nunez-2");
    expect(parteAscii(undefined)).toBe("");
  });
});

describe("display names (RF-21)", () => {
  it("name, else email, else the fallback; never the id", () => {
    const nombres = mapaDeNombres([A, B, SIN_DATOS], [persona(A, "Ana", "Gómez"), persona(B, null, null, "b@mitsm.test")]);
    expect(nombres.get(A)).toBe("Ana Gómez");
    expect(nombres.get(B)).toBe("b@mitsm.test");
    expect(nombres.get(SIN_DATOS)).toBe(copyRecibos.usuarioNoDisponible);
  });
});

describe("armarFilas (decision 6)", () => {
  const recibo = (id: string, empleado: string, estadoRecibo: "pendiente" | "firmado", firmado: string | null = null) => ({
    id,
    empleado_id: empleado,
    estado: estadoRecibo,
    firmado_at: firmado,
    cargado_at: "2026-11-10T13:00:00Z",
  });

  it("every active employee, plus a deactivated one with a receipt (tagged), by surname", () => {
    const filas = armarFilas(
      [A, B],
      [recibo("r-b", B, "firmado", "2026-11-12T18:30:00Z"), recibo("r-c", C, "pendiente")],
      new Set([C]),
      [persona(A, "Ana", "Zapata"), persona(B, "Beto", "Álvarez"), persona(C, "Caro", "Medina")],
    );
    expect(filas.map((f) => [f.nombre, f.estado, f.inactiva, f.firmadoAt])).toEqual([
      ["Beto Álvarez", "firmado", false, "12/11/2026 15:30"],
      ["Caro Medina", "pendiente", true, null],
      ["Ana Zapata", "sin_recibo", false, null],
    ]);
    expect(filas.find((f) => f.estado === "sin_recibo")).toMatchObject({ reciboId: null, cargadoAt: null });
    expect(filas.find((f) => f.nombre === "Caro Medina")).toMatchObject({ reciboId: "r-c", cargadoAt: "10/11/2026 10:00" });
    expect(contarEstados(filas)).toEqual({ firmado: 1, pendiente: 1, sin_recibo: 1 });
  });

  it("a deactivated account without a receipt is not listed", () => {
    expect(armarFilas([A], [], new Set([C]), [persona(A, "Ana", "Gómez")]).map((f) => f.empleadoId)).toEqual([A]);
  });

  it("the shown name is never an id", () => {
    const filas = armarFilas([SIN_DATOS], [], new Set(), []);
    expect(filas[0].nombre).toBe(copyRecibos.usuarioNoDisponible);
  });
});

describe("armarDetalle (decision 8)", () => {
  const nombres = mapaDeNombres([A, ADMIN, B], [persona(A, "Ana", "Gómez"), persona(ADMIN, "Admin", "Prueba"), persona(B, null, null, "b@mitsm.test")]);
  const recibo = {
    id: "r1",
    empleado_id: A,
    estado: "firmado" as const,
    cargado_at: "2026-11-10T13:00:00Z",
    cargado_por: ADMIN,
    firmado_at: "2026-11-12T18:30:00Z",
    firma_id: "f2",
    recibo_periodos: { anio: 2026, mes: 11, estado: "publicado" as const },
  };
  const historial = [
    { id: "h1", reemplazado_at: "2026-11-05T12:00:00Z", reemplazado_por: ADMIN, estado_al_reemplazo: "pendiente" as const, firmado_at: null, cargado_at: "2026-11-01T12:00:00Z" },
    { id: "h2", reemplazado_at: "2026-11-09T12:00:00Z", reemplazado_por: B, estado_al_reemplazo: "firmado" as const, firmado_at: "2026-11-07T12:00:00Z", cargado_at: "2026-11-05T12:00:00Z" },
  ];

  it("current file, evidence, overrides and replacements (newest first, numbered from the oldest), with names", () => {
    const detalle = armarDetalle(
      recibo,
      [
        { firmado_at: "2026-11-12T18:30:00Z", firma_id: "f2" },
        { firmado_at: "2026-11-07T12:00:00Z", firma_id: "f1" },
      ],
      [{ id: "o1", motivo: "no_verificable", admin_id: ADMIN, created_at: "2026-11-10T13:00:00Z" }],
      historial,
      new Map([
        ["f1", 1],
        ["f2", 2],
      ]),
      nombres,
    );
    expect(detalle).toEqual({
      reciboId: "r1",
      nombre: "Ana Gómez",
      periodo: { anio: 2026, mes: 11, estado: "publicado" },
      actual: { estado: "firmado", cargadoAt: "10/11/2026 10:00", cargadoPor: "Admin Prueba" },
      firma: { firmadoAt: "12/11/2026 15:30", version: 2, firmaId: "f2" },
      overrides: [{ clave: "o1", motivo: "no_verificable", quien: "Admin Prueba", cuando: "10/11/2026 10:00" }],
      reemplazos: [
        { historialId: "h2", numero: 2, quien: "b@mitsm.test", cuando: "09/11/2026 09:00", estadoAlReemplazo: "firmado", firmadoAt: "07/11/2026 09:00", cargadoAt: "05/11/2026 09:00" },
        { historialId: "h1", numero: 1, quien: "Admin Prueba", cuando: "05/11/2026 09:00", estadoAlReemplazo: "pendiente", firmadoAt: null, cargadoAt: "01/11/2026 09:00" },
      ],
    });
  });

  it("a pending receipt has no signature; an unknown actor gets the fallback, never the id", () => {
    const detalle = armarDetalle({ ...recibo, estado: "pendiente", firmado_at: null, firma_id: null, cargado_por: SIN_DATOS }, [], [], [], new Map(), nombres);
    expect(detalle.firma).toBeNull();
    expect(detalle.actual.cargadoPor).toBe(copyRecibos.usuarioNoDisponible);
    expect(JSON.stringify([detalle.nombre, detalle.actual])).not.toContain(SIN_DATOS);
  });
});

describe("loaders refuse a non-Admin before any read", () => {
  it.each([
    ["cargarEstadoPeriodo", () => estado.cargarEstadoPeriodo(A)],
    ["cargarDetalleRecibo", () => estado.cargarDetalleRecibo(A)],
    ["contarEmpleadosConRecibosSinFirmar", () => estado.contarEmpleadosConRecibosSinFirmar()],
  ])("%s", async (_nombre, cargar) => {
    mocks.admin = false;
    await expect(cargar()).resolves.toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.listarCuentas).not.toHaveBeenCalled();
  });
});

describe("contarEmpleadosConRecibosSinFirmar", () => {
  // A query double: records the filters and answers pages of rows.
  function clienteConPaginas(paginas: { empleado_id: string }[][], registro: unknown[][]) {
    let pagina = 0;
    const consulta: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "in", "order"]) {
      consulta[metodo] = (...args: unknown[]) => {
        registro.push([metodo, ...args]);
        return consulta;
      };
    }
    consulta.range = async (...args: unknown[]) => {
      registro.push(["range", ...args]);
      return { data: paginas[pagina++] ?? [], error: null };
    };
    return { from: (tabla: string) => (registro.push(["from", tabla]), consulta) };
  }

  it("counts distinct employees over every page, pending receipts of visible periods only", async () => {
    const llena = Array.from({ length: estado.PAGINA }, (_, i) => ({ empleado_id: i % 2 === 0 ? A : B }));
    const registro: unknown[][] = [];
    mocks.createClient.mockResolvedValue(clienteConPaginas([llena, [{ empleado_id: C }, { empleado_id: A }]], registro));
    await expect(estado.contarEmpleadosConRecibosSinFirmar()).resolves.toBe(3);
    expect(registro).toContainEqual(["from", "recibos"]);
    expect(registro).toContainEqual(["eq", "estado", "pendiente"]);
    expect(registro).toContainEqual(["in", "recibo_periodos.estado", ["publicado", "cerrado"]]);
    expect(registro.filter((r) => r[0] === "range")).toEqual([
      ["range", 0, estado.PAGINA - 1],
      ["range", estado.PAGINA, 2 * estado.PAGINA - 1],
    ]);
  });

  it("zero is a number, not null", async () => {
    mocks.createClient.mockResolvedValue(clienteConPaginas([[]], []));
    await expect(estado.contarEmpleadosConRecibosSinFirmar()).resolves.toBe(0);
  });
});
