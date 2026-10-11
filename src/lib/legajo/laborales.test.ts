import { describe, expect, it } from "vitest";
import type { CatalogoItem, CatalogoLista } from "@/lib/configuracion/listas";
import { copy } from "@/lib/copy/es-AR";
import { copyLaborales } from "@/lib/copy/laborales";
import {
  formLaboralInicial,
  nombreItem,
  opcionesCampo,
  validarDatosLaborales,
  valoresLaborales,
  type ActualLaboral,
} from "./laborales";

const v = copy.legajo.validation;

let n = 0;
function item(lista: CatalogoLista, nombre: string, extra: Partial<CatalogoItem> = {}): CatalogoItem {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return { id, lista, nombre, areaId: null, posicion: n, activo: true, version: 1, ...extra };
}

const ventas = item("area", "Ventas");
const logistica = item("area", "Logística");
const cerrada = item("area", "Cerrada", { activo: false });
const mostrador = item("puesto", "Mostrador", { areaId: ventas.id });
const cajaVieja = item("puesto", "Caja vieja", { areaId: ventas.id, activo: false });
const deposito = item("puesto", "Depósito", { areaId: logistica.id });
const huerfano = item("puesto", "De área cerrada", { areaId: cerrada.id });
const central = item("sucursal", "Casa Central");
const pacheco = item("sucursal", "Pacheco", { activo: false });
const cajero = item("tarea", "Cajero");
const comercio = item("convenio", "Comercio");
const categoriaA = item("categoria", "A");
const ITEMS = [ventas, logistica, cerrada, mostrador, cajaVieja, deposito, huerfano, central, pacheco, cajero, comercio, categoriaA];

const completo: ActualLaboral = {
  numero_legajo: "L-1",
  area_id: ventas.id,
  puesto_id: mostrador.id,
  fecha_ingreso: "2020-03-01",
  estado_laboral: "activo",
  sucursal_id: central.id,
  tarea_id: cajero.id,
  convenio_id: null,
  categoria_id: categoriaA.id,
};

const valores = (cambios: ActualLaboral = {}, base: ActualLaboral = completo) =>
  valoresLaborales(formLaboralInicial({ ...base, ...cambios }));

describe("group E form", () => {
  it("starts from the stored values, empty for nulls or a missing row", () => {
    expect(formLaboralInicial(completo)).toMatchObject({ area_id: ventas.id, convenio_id: "" });
    expect(formLaboralInicial(null)).toEqual({
      numero_legajo: "",
      area_id: "",
      puesto_id: "",
      fecha_ingreso: "",
      estado_laboral: "",
      sucursal_id: "",
      tarea_id: "",
      convenio_id: "",
      categoria_id: "",
    });
  });

  it("sends an empty select as null", () => {
    expect(valores({ tarea_id: null })).toMatchObject({ tarea_id: null, convenio_id: null, area_id: ventas.id });
  });
});

describe("opcionesCampo", () => {
  it("offers active items in Configuración order", () => {
    expect(opcionesCampo(ITEMS, "area_id", { actual: null }).map((o) => o.label)).toEqual(["Ventas", "Logística"]);
    expect(opcionesCampo(ITEMS, "sucursal_id", { actual: null }).map((o) => o.label)).toEqual(["Casa Central"]);
  });

  it("filters Puestos by the chosen Área, and none without one or under an inactive Área", () => {
    expect(opcionesCampo(ITEMS, "puesto_id", { actual: null, areaId: ventas.id }).map((o) => o.label)).toEqual(["Mostrador"]);
    expect(opcionesCampo(ITEMS, "puesto_id", { actual: null, areaId: logistica.id }).map((o) => o.label)).toEqual(["Depósito"]);
    expect(opcionesCampo(ITEMS, "puesto_id", { actual: null, areaId: null })).toEqual([]);
    expect(opcionesCampo(ITEMS, "puesto_id", { actual: null, areaId: cerrada.id })).toEqual([]);
  });

  it("keeps the current item when it is inactive, marked", () => {
    const sucursales = opcionesCampo(ITEMS, "sucursal_id", { actual: pacheco.id });
    expect(sucursales).toContainEqual({ value: pacheco.id, label: "Pacheco (inactivo)" });
    const puestos = opcionesCampo(ITEMS, "puesto_id", { actual: cajaVieja.id, areaId: ventas.id });
    expect(puestos.map((o) => o.label)).toEqual(["Mostrador", "Caja vieja (inactivo)"]);
    // Under another Área the old Puesto is not offered.
    expect(opcionesCampo(ITEMS, "puesto_id", { actual: cajaVieja.id, areaId: logistica.id }).map((o) => o.label)).toEqual(["Depósito"]);
  });

  it("names an inactive item with the mark", () => {
    expect(nombreItem(pacheco)).toBe(formatInactivo("Pacheco"));
    expect(nombreItem(central)).toBe("Casa Central");
  });
});

function formatInactivo(nombre: string) {
  return copyLaborales.form.inactivo.replace("{nombre}", nombre);
}

describe("validarDatosLaborales", () => {
  it("accepts a complete group E with optional fields empty", () => {
    const result = validarDatosLaborales(valores({ tarea_id: null, categoria_id: null }), ITEMS, null);
    expect(result.ok && result.datos).toMatchObject({ area_id: ventas.id, tarea_id: null, numero_legajo: "L-1" });
  });

  it("requires número de legajo, Área, Puesto, fecha de ingreso, estado laboral and Sucursal", () => {
    const result = validarDatosLaborales(valores({}, {}), ITEMS, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors).toEqual({
        numero_legajo: v.required,
        area_id: v.required,
        puesto_id: v.required,
        fecha_ingreso: v.required,
        estado_laboral: v.required,
        sucursal_id: v.required,
      });
    }
  });

  it("refuses an id from another list, or one that does not exist", () => {
    for (const [campo, id] of [
      ["sucursal_id", cajero.id],
      ["tarea_id", "99999999-9999-4999-8999-999999999999"],
      ["area_id", mostrador.id],
    ] as const) {
      const result = validarDatosLaborales(valores({ [campo]: id }), ITEMS, completo);
      expect(!result.ok && result.fieldErrors[campo], campo).toBe(v.optionInvalid);
    }
  });

  it("refuses a Puesto of another Área", () => {
    const result = validarDatosLaborales(valores({ puesto_id: deposito.id }), ITEMS, completo);
    expect(!result.ok && result.fieldErrors.puesto_id).toBe(v.puestoFueraDeArea);
  });

  it("keeps an inactive current item on a save that does not change it", () => {
    const actual = { ...completo, sucursal_id: pacheco.id, puesto_id: cajaVieja.id };
    expect(validarDatosLaborales(valores({}, actual), ITEMS, actual).ok).toBe(true);
    const otraArea = { ...completo, area_id: cerrada.id, puesto_id: huerfano.id };
    expect(validarDatosLaborales(valores({ numero_legajo: "L-2" }, otraArea), ITEMS, otraArea).ok).toBe(true);
  });

  it("refuses an inactive item, or a Puesto of an inactive Área, newly chosen", () => {
    const sucursal = validarDatosLaborales(valores({ sucursal_id: pacheco.id }), ITEMS, completo);
    expect(!sucursal.ok && sucursal.fieldErrors.sucursal_id).toBe(v.itemInactivo);
    const puesto = validarDatosLaborales(valores({ puesto_id: cajaVieja.id }), ITEMS, completo);
    expect(!puesto.ok && puesto.fieldErrors.puesto_id).toBe(v.itemInactivo);
    const area = validarDatosLaborales(valores({ area_id: cerrada.id, puesto_id: huerfano.id }), ITEMS, completo);
    expect(!area.ok && area.fieldErrors).toEqual({ area_id: v.itemInactivo, puesto_id: v.itemInactivo });
    // With no current values at all (a first save), nothing inactive is allowed.
    const primera = validarDatosLaborales(valores({ sucursal_id: pacheco.id }), ITEMS, null);
    expect(!primera.ok && primera.fieldErrors.sucursal_id).toBe(v.itemInactivo);
  });
});
