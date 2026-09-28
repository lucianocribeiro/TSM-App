import { describe, expect, it, vi } from "vitest";
import type { LegajoListItem } from "@/lib/legajo/listado";

// The Legajos page computes the KPI cards on the server from the whole list
// and hands them to the screen once: filters, search and the deactivated
// toggle live in the screen and never reach them.

const base = { nombres: null, apellido: null, dni: null, cuil: null, numeroLegajo: null, area: null, puesto: null, sede: null, modalidad: null, estadoLaboral: null };
const hoy = new Date();
const mesActual = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit" }).format(hoy);
const LISTA: LegajoListItem[] = [
  { ...base, profileId: "a", nombre: "Ana", fechaIngreso: `${mesActual}-01`, estadoCuenta: "activa" },
  { ...base, profileId: "b", nombre: "Beto", fechaIngreso: "2001-01-01", estadoCuenta: "activa" },
  { ...base, profileId: "c", nombre: "Carla", fechaIngreso: `${mesActual}-01`, estadoCuenta: "inactiva" },
];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: async () => ({ id: "admin" }) }));
vi.mock("@/lib/legajo/admin-legajos", () => ({ cargarListadoLegajos: async () => LISTA }));
vi.mock("./LegajosScreen", () => ({ LegajosScreen: () => null }));

const { default: LegajosPage } = await import("./page");

describe("LegajosPage", () => {
  it("passes KPI cards computed from the whole list, deactivated accounts excluded", async () => {
    const element = await LegajosPage();
    expect(element.props).toMatchObject({ legajos: LISTA, listaFallo: false, kpis: { activos: 2, ingresosDelMes: 1 } });
  });
});
