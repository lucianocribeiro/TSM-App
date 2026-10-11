import { describe, expect, it } from "vitest";
import {
  disponibleParaSeleccion,
  enUso,
  esLista,
  itemsDeGrupo,
  mover,
  nombresDelGrupo,
  opcionesDisponibles,
  vecinoDe,
  type CatalogoItem,
} from "./listas";

function item(id: string, extra: Partial<CatalogoItem> = {}): CatalogoItem {
  return { id, lista: "sucursal", nombre: id, areaId: null, posicion: 1, activo: true, version: 1, ...extra };
}

const ventas = item("ventas", { lista: "area", posicion: 1 });
const gerencia = item("gerencia", { lista: "area", posicion: 2, activo: false });
const logistica = item("logistica", { lista: "area", posicion: 3 });
const mostrador = item("mostrador", { lista: "puesto", areaId: "ventas", posicion: 2 });
const cuentas = item("cuentas", { lista: "puesto", areaId: "ventas", posicion: 1 });
const director = item("director", { lista: "puesto", areaId: "gerencia", posicion: 1 });
const centro = item("centro", { posicion: 3 });
const norte = item("norte", { posicion: 1 });
const sur = item("sur", { posicion: 2, activo: false });
const ITEMS = [ventas, gerencia, logistica, mostrador, cuentas, director, centro, norte, sur];

describe("esLista", () => {
  it("accepts the six lists only", () => {
    for (const lista of ["area", "puesto", "sucursal", "convenio", "tarea", "categoria"]) expect(esLista(lista)).toBe(true);
    for (const otro of ["", "Area", "legajo", undefined, ["area"]]) expect(esLista(otro)).toBe(false);
  });
});

describe("itemsDeGrupo and nombresDelGrupo", () => {
  it("returns a list, or an Área's Puestos, in order", () => {
    expect(itemsDeGrupo(ITEMS, "sucursal").map((i) => i.id)).toEqual(["norte", "sur", "centro"]);
    expect(itemsDeGrupo(ITEMS, "puesto", "ventas").map((i) => i.id)).toEqual(["cuentas", "mostrador"]);
    expect(itemsDeGrupo(ITEMS, "puesto", "logistica")).toEqual([]);
  });

  it("leaves out the item being renamed", () => {
    expect(nombresDelGrupo(ITEMS, "sucursal", null, "sur")).toEqual(["norte", "centro"]);
    expect(nombresDelGrupo(ITEMS, "puesto", "ventas")).toEqual(["cuentas", "mostrador"]);
  });
});

describe("reorder", () => {
  const grupo = itemsDeGrupo(ITEMS, "sucursal");

  it("finds the neighbour, or none at an end", () => {
    expect(vecinoDe(grupo, "sur", "arriba")?.id).toBe("norte");
    expect(vecinoDe(grupo, "sur", "abajo")?.id).toBe("centro");
    expect(vecinoDe(grupo, "norte", "arriba")).toBeNull();
    expect(vecinoDe(grupo, "centro", "abajo")).toBeNull();
    expect(vecinoDe(grupo, "otro", "abajo")).toBeNull();
  });

  it("swaps the two positions and keeps the others", () => {
    const movido = mover(grupo, "centro", "arriba");
    expect(movido.map((i) => [i.id, i.posicion])).toEqual([
      ["norte", 1],
      ["centro", 2],
      ["sur", 3],
    ]);
    expect(mover(movido, "centro", "arriba").map((i) => i.id)).toEqual(["centro", "norte", "sur"]);
  });

  it("leaves the order as it was at an end, and works with gaps", () => {
    expect(mover(grupo, "norte", "arriba").map((i) => i.id)).toEqual(["norte", "sur", "centro"]);
    const conHuecos = [item("a", { posicion: 2 }), item("b", { posicion: 7 }), item("c", { posicion: 9 })];
    expect(mover(conHuecos, "c", "arriba").map((i) => [i.id, i.posicion])).toEqual([
      ["a", 2],
      ["c", 7],
      ["b", 9],
    ]);
  });
});

describe("enUso", () => {
  it("an Área with Puestos is in use; an empty Área and the other lists are not (until CR-2)", () => {
    expect(enUso(ITEMS, ventas)).toBe(true);
    expect(enUso(ITEMS, gerencia)).toBe(true);
    expect(enUso(ITEMS, logistica)).toBe(false);
    expect(enUso(ITEMS, norte)).toBe(false);
    expect(enUso(ITEMS, cuentas)).toBe(false);
  });
});

describe("selection rules", () => {
  it("offers active items only; a Puesto also needs its Área active", () => {
    expect(disponibleParaSeleccion(ITEMS, norte)).toBe(true);
    expect(disponibleParaSeleccion(ITEMS, sur)).toBe(false);
    expect(disponibleParaSeleccion(ITEMS, cuentas)).toBe(true);
    // Active itself, hidden by its inactive Área.
    expect(disponibleParaSeleccion(ITEMS, director)).toBe(false);
    expect(director.activo).toBe(true);
  });

  it("reactivating the Área shows its Puestos again", () => {
    const reactivada = ITEMS.map((i) => (i.id === "gerencia" ? { ...i, activo: true } : i));
    expect(opcionesDisponibles(reactivada, "puesto", "gerencia").map((i) => i.id)).toEqual(["director"]);
    expect(opcionesDisponibles(ITEMS, "puesto", "gerencia")).toEqual([]);
  });

  it("lists the options in order", () => {
    expect(opcionesDisponibles(ITEMS, "sucursal").map((i) => i.id)).toEqual(["norte", "centro"]);
    expect(opcionesDisponibles(ITEMS, "area").map((i) => i.id)).toEqual(["ventas", "logistica"]);
  });
});
