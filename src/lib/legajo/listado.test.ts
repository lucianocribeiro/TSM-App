import { describe, expect, it } from "vitest";
import {
  coincideBusqueda,
  filtrarLegajos,
  FILTROS_INICIALES,
  itemDesdeFila,
  opcionesDistintas,
  type LegajoListItem,
} from "./listado";

function item(overrides: Partial<LegajoListItem> = {}): LegajoListItem {
  return {
    profileId: "p1",
    nombre: "José Pérez",
    nombres: "José",
    apellido: "Pérez",
    dni: "30111222",
    cuil: "20-30111222-4",
    numeroLegajo: "L-0042",
    area: "Operaciones",
    puesto: "Chofer",
    sede: "San Martín",
    modalidad: "Presencial",
    estadoLaboral: "activo",
    fechaIngreso: "2020-03-01",
    estadoCuenta: "activa",
    ...overrides,
  };
}

describe("itemDesdeFila", () => {
  it("builds the full name and keeps the account state", () => {
    const fila = {
      profile_id: "p9",
      nombres: " Ana ",
      apellido: "Gómez",
      dni: null,
      cuil: null,
      numero_legajo: null,
      area: null,
      puesto: null,
      sede: null,
      modalidad: null,
      estado_laboral: null,
      fecha_ingreso: null,
      estado_cuenta: "inactiva" as const,
    };
    expect(itemDesdeFila(fila)).toMatchObject({ profileId: "p9", nombre: "Ana Gómez", nombres: "Ana", estadoCuenta: "inactiva" });
    expect(itemDesdeFila({ ...fila, nombres: null, apellido: "  " }).nombre).toBeNull();
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
    item({ profileId: "a", nombre: "Ana Gómez", nombres: "Ana", apellido: "Gómez", area: "Administración", estadoLaboral: "en_prueba" }),
    item({ profileId: "b", nombre: "Bruno Álvarez", nombres: "Bruno", apellido: "Álvarez", sede: "Pilar", modalidad: "Remota" }),
    item({ profileId: "c", nombre: "Carla Díaz", nombres: "Carla", apellido: "Díaz", estadoCuenta: "inactiva" }),
    item({ profileId: "d", nombre: null, nombres: null, apellido: null, numeroLegajo: null, estadoLaboral: null }),
  ];
  const ids = (list: LegajoListItem[]) => list.map((i) => i.profileId);

  it("hides deactivated accounts unless asked, and sorts by apellido with nameless rows last", () => {
    expect(ids(filtrarLegajos(items, FILTROS_INICIALES))).toEqual(["b", "a", "d"]);
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, mostrarBajas: true }))).toEqual(["b", "c", "a", "d"]);
  });

  it("filters by estado laboral, área, sede and modalidad (text compared without case or accents)", () => {
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, estadoLaboral: "en_prueba" }))).toEqual(["a"]);
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, area: "administracion" }))).toEqual(["a"]);
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, sede: "Pilar" }))).toEqual(["b"]);
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, modalidad: "Remota" }))).toEqual(["b"]);
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, modalidad: "Remota", sede: "San Martín" }))).toEqual([]);
  });

  it("combines search, filters and the deactivated toggle", () => {
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, busqueda: "carla" }))).toEqual([]);
    expect(ids(filtrarLegajos(items, { ...FILTROS_INICIALES, busqueda: "carla", mostrarBajas: true }))).toEqual(["c"]);
  });
});

describe("opcionesDistintas", () => {
  it("returns trimmed distinct values, merging case and accents, sorted es-AR", () => {
    const items = [
      item({ area: "Operaciones" }),
      item({ area: " operaciones " }),
      item({ area: "Administración" }),
      item({ area: "administracion" }),
      item({ area: null }),
      item({ area: "  " }),
    ];
    expect(opcionesDistintas(items, "area")).toEqual(["Administración", "Operaciones"]);
  });
});
