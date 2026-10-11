import { describe, expect, it } from "vitest";
import type { CatalogoItem, CatalogoLista } from "@/lib/configuracion/listas";
import {
  coincideBusqueda,
  filtrarLegajos,
  FILTROS_INICIALES,
  itemDesdeFila,
  opcionesFiltro,
  type LegajoListItem,
} from "./listado";

function catalogo(id: string, lista: CatalogoLista, nombre: string, extra: Partial<CatalogoItem> = {}): CatalogoItem {
  return { id, lista, nombre, areaId: null, posicion: 1, activo: true, version: 1, ...extra };
}
const ITEMS = [
  catalogo("area-ops", "area", "Operaciones", { posicion: 1 }),
  catalogo("area-adm", "area", "Administración", { posicion: 2 }),
  catalogo("area-vieja", "area", "Taller", { posicion: 3, activo: false }),
  catalogo("area-sin-uso", "area", "Sin uso", { posicion: 4, activo: false }),
  catalogo("puesto-chofer", "puesto", "Chofer", { areaId: "area-ops" }),
  catalogo("suc-sm", "sucursal", "San Martín", { posicion: 1 }),
  catalogo("suc-pilar", "sucursal", "Pilar", { posicion: 2 }),
  catalogo("tarea-adm", "tarea", "Administrativo", { posicion: 1 }),
  catalogo("tarea-caj", "tarea", "Cajero", { posicion: 2 }),
];

function item(overrides: Partial<LegajoListItem> = {}): LegajoListItem {
  return {
    profileId: "p1",
    nombre: "José Pérez",
    nombres: "José",
    apellido: "Pérez",
    dni: "30111222",
    cuil: "20-30111222-4",
    numeroLegajo: "L-0042",
    areaId: "area-ops",
    area: "Operaciones",
    puesto: "Chofer",
    sucursalId: "suc-sm",
    sucursal: "San Martín",
    tareaId: "tarea-adm",
    tarea: "Administrativo",
    estadoLaboral: "activo",
    fechaIngreso: "2020-03-01",
    estadoCuenta: "activa",
    ...overrides,
  };
}

describe("itemDesdeFila", () => {
  const fila = {
    profile_id: "p9",
    nombres: " Ana ",
    apellido: "Gómez",
    dni: null,
    cuil: null,
    laboral: {
      numero_legajo: "L-9",
      area_id: "area-vieja",
      puesto_id: "puesto-chofer",
      sucursal_id: "suc-pilar",
      tarea_id: null,
      estado_laboral: "en_prueba" as const,
      fecha_ingreso: "2024-01-02",
    },
    estado_cuenta: "inactiva" as const,
  };

  it("builds the full name, keeps the account state and names the list items (inactive marked)", () => {
    expect(itemDesdeFila(fila, ITEMS)).toMatchObject({
      profileId: "p9",
      nombre: "Ana Gómez",
      nombres: "Ana",
      estadoCuenta: "inactiva",
      numeroLegajo: "L-9",
      areaId: "area-vieja",
      area: "Taller (inactivo)",
      puesto: "Chofer",
      sucursalId: "suc-pilar",
      sucursal: "Pilar",
      tareaId: null,
      tarea: null,
      estadoLaboral: "en_prueba",
      fechaIngreso: "2024-01-02",
    });
    expect(itemDesdeFila({ ...fila, nombres: null, apellido: "  " }, ITEMS).nombre).toBeNull();
  });

  it("leaves group E empty when the row is missing", () => {
    expect(itemDesdeFila({ ...fila, laboral: null }, ITEMS)).toMatchObject({ numeroLegajo: null, areaId: null, area: null, estadoLaboral: null });
  });
});

describe("coincideBusqueda", () => {
  const a = item();

  it("matches the name in either order, ignoring case and accents", () => {
    for (const term of ["jose", "PEREZ", "josé pér", "perez jose", "  Jose   Perez "]) {
      expect(coincideBusqueda(a, term), term).toBe(true);
    }
    expect(coincideBusqueda(a, "maria")).toBe(false);
  });

  it("matches DNI and número de legajo", () => {
    expect(coincideBusqueda(a, "30111222")).toBe(true);
    expect(coincideBusqueda(a, "3011")).toBe(true);
    expect(coincideBusqueda(a, "l-0042")).toBe(true);
    expect(coincideBusqueda(a, "0042")).toBe(true);
  });

  it("matches the CUIL with or without hyphens", () => {
    expect(coincideBusqueda(a, "20-30111222-4")).toBe(true);
    expect(coincideBusqueda(a, "20301112224")).toBe(true);
    expect(coincideBusqueda(a, "20-3011")).toBe(true);
    expect(coincideBusqueda(a, "27-30111222-4")).toBe(false);
  });

  it("does not match digits against rows without DNI or CUIL", () => {
    expect(coincideBusqueda(item({ dni: null, cuil: null, numeroLegajo: null }), "301")).toBe(false);
  });

  it("an empty search matches everything", () => {
    expect(coincideBusqueda(item({ nombre: null, nombres: null, apellido: null }), "  ")).toBe(true);
  });
});

describe("filtrarLegajos", () => {
  const items = [
    item({ profileId: "a", nombre: "Ana Gómez", nombres: "Ana", apellido: "Gómez", areaId: "area-adm", estadoLaboral: "en_prueba" }),
    item({ profileId: "b", nombre: "Bruno Álvarez", nombres: "Bruno", apellido: "Álvarez", sucursalId: "suc-pilar", tareaId: "tarea-caj" }),
    item({ profileId: "c", nombre: "Carla Díaz", nombres: "Carla", apellido: "Díaz", estadoCuenta: "inactiva" }),
    item({ profileId: "d", nombre: null, nombres: null, apellido: null, numeroLegajo: null, estadoLaboral: null }),
  ];
  const ids = (list: LegajoListItem[]) => list.map((i) => i.profileId);

  it("hides deactivated accounts unless asked, and sorts by apellido with nameless rows last", () => {
    expect(ids(filtrarLegajos(items, FILTROS_INICIALES))).toEqual(["b", "a", "d"]);
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, mostrarBajas: true }))).toEqual(["b", "c", "a", "d"]);
  });

  it("filters by estado laboral, and by Área, Sucursal and Tarea item", () => {
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, estadoLaboral: "en_prueba" }))).toEqual(["a"]);
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, areaId: "area-adm" }))).toEqual(["a"]);
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, sucursalId: "suc-pilar" }))).toEqual(["b"]);
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, tareaId: "tarea-caj" }))).toEqual(["b"]);
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, tareaId: "tarea-caj", sucursalId: "suc-sm" }))).toEqual([]);
  });

  it("combines search, filters and the deactivated toggle", () => {
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, busqueda: "carla" }))).toEqual([]);
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, busqueda: "carla", mostrarBajas: true }))).toEqual(["c"]);
  });
});

describe("opcionesFiltro", () => {
  it("offers the active items in Configuración order, plus inactive ones still in use, marked", () => {
    const legajos = [item({ areaId: "area-vieja" }), item({ areaId: null })];
    expect(opcionesFiltro(ITEMS, legajos, "area")).toEqual([
      { value: "area-ops", label: "Operaciones" },
      { value: "area-adm", label: "Administración" },
      { value: "area-vieja", label: "Taller (inactivo)" },
    ]);
    expect(opcionesFiltro(ITEMS, legajos, "sucursal").map((o) => o.label)).toEqual(["San Martín", "Pilar"]);
    expect(opcionesFiltro(ITEMS, legajos, "tarea").map((o) => o.label)).toEqual(["Administrativo", "Cajero"]);
  });
});
