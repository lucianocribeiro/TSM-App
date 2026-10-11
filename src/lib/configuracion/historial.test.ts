import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { filaHistorial, type EventoCatalogo } from "./historial";

const t = copy.configuracion.historial;
const ACTOR = "11111111-1111-4111-8111-111111111111";
const nombres = new Map([[ACTOR, "Ana Pérez"]]);

function evento(extra: Partial<EventoCatalogo>): EventoCatalogo {
  return {
    id: "e1",
    lista: "sucursal",
    itemNombre: "Pacheco",
    areaNombre: null,
    accion: "alta",
    valorAnterior: null,
    valorNuevo: "Pacheco",
    actorId: ACTOR,
    fecha: "2026-10-11T03:30:00Z",
    ...extra,
  };
}

describe("filaHistorial", () => {
  it("shows the date in Argentina's time, the user's name, the list, the item and the action", () => {
    expect(filaHistorial(evento({}), nombres)).toEqual({
      id: "e1",
      fecha: "11/10/2026, 00:30",
      usuario: "Ana Pérez",
      lista: copy.configuracion.listas.sucursal,
      item: "Pacheco",
      accion: t.acciones.alta,
      antes: t.sinValor,
      despues: "Pacheco",
    });
  });

  it("names a Puesto's Área", () => {
    const fila = filaHistorial(evento({ lista: "puesto", areaNombre: "Ventas", itemNombre: "Mostrador (SM)" }), nombres);
    expect(fila.lista).toBe(`${copy.configuracion.listas.puesto} (Ventas)`);
  });

  it("shows names before and after a rename, and the old name of a deletion", () => {
    const renombre = filaHistorial(evento({ accion: "renombre", valorAnterior: "Pacheco", valorNuevo: "Gral. Pacheco" }), nombres);
    expect([renombre.accion, renombre.antes, renombre.despues]).toEqual([t.acciones.renombre, "Pacheco", "Gral. Pacheco"]);
    const baja = filaHistorial(evento({ accion: "baja", valorAnterior: "Pacheco", valorNuevo: null }), nombres);
    expect([baja.accion, baja.antes, baja.despues]).toEqual([t.acciones.baja, "Pacheco", t.sinValor]);
  });

  it("shows positions and states in words", () => {
    const reorden = filaHistorial(evento({ accion: "reorden", valorAnterior: "3", valorNuevo: "2" }), nombres);
    expect([reorden.antes, reorden.despues]).toEqual(["Posición 3", "Posición 2"]);
    const baja = filaHistorial(evento({ accion: "desactivacion", valorAnterior: "activo", valorNuevo: "inactivo" }), nombres);
    expect([baja.accion, baja.antes, baja.despues]).toEqual([
      t.acciones.desactivacion,
      copy.configuracion.estados.activo,
      copy.configuracion.estados.inactivo,
    ]);
    const alta = filaHistorial(evento({ accion: "reactivacion", valorAnterior: "inactivo", valorNuevo: "activo" }), nombres);
    expect([alta.accion, alta.antes, alta.despues]).toEqual([
      t.acciones.reactivacion,
      copy.configuracion.estados.inactivo,
      copy.configuracion.estados.activo,
    ]);
  });

  it("shows the id of an actor it cannot name", () => {
    expect(filaHistorial(evento({}), new Map()).usuario).toBe(ACTOR);
  });
});
