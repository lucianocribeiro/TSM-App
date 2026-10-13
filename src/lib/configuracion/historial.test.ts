import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { filaHistorial, nombreDeActor, nombresDeActores, type EventoCatalogo } from "./historial";

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

  it("shows a Puesto's Sucursal por defecto by name, or none in words (CR-5)", () => {
    const fila = filaHistorial(
      evento({ lista: "puesto", areaNombre: "Ventas", itemNombre: "Mostrador (PA)", accion: "sucursal_defecto", valorAnterior: null, valorNuevo: "Pacheco" }),
      nombres,
    );
    expect([fila.accion, fila.antes, fila.despues]).toEqual([t.acciones.sucursal_defecto, copy.configuracion.sucursalDefecto.ninguna, "Pacheco"]);
    const quitada = filaHistorial(evento({ accion: "sucursal_defecto", valorAnterior: "Pacheco", valorNuevo: null }), nombres);
    expect([quitada.antes, quitada.despues]).toEqual(["Pacheco", copy.configuracion.sucursalDefecto.ninguna]);
  });
});

// AUDCR1-01: an actor who cannot be named is never shown by id.
describe("an actor who cannot be resolved", () => {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  // Everything the view renders (id is only the React key, never rendered).
  const visible = (fila: ReturnType<typeof filaHistorial>) =>
    Object.entries(fila)
      .filter(([campo]) => campo !== "id")
      .map(([, valor]) => valor)
      .join(" | ");

  it("shows the fallback copy, not the id", () => {
    const fila = filaHistorial(evento({}), new Map());
    expect(fila.usuario).toBe(t.usuarioNoDisponible);
    expect(t.usuarioNoDisponible).toBe("Usuario no disponible");
    expect(visible(fila)).not.toMatch(UUID);
  });

  it("an account with neither name nor email, or a missing one, is not named", () => {
    const nombres = nombresDeActores([
      { id: ACTOR, nombre: "  ", email: "" },
      { id: "22222222-2222-4222-8222-222222222222", nombre: null, email: null },
    ]);
    expect(nombres.size).toBe(0);
    expect(filaHistorial(evento({}), nombres).usuario).toBe(t.usuarioNoDisponible);
    expect(filaHistorial(evento({ actorId: "33333333-3333-4333-8333-333333333333" }), nombres).usuario).toBe(t.usuarioNoDisponible);
  });

  it("if the account lookup fails, every row shows the fallback and no id", () => {
    const sinCuentas = nombresDeActores([]);
    const filas = (["alta", "renombre", "reorden", "desactivacion", "reactivacion", "baja"] as const).map((accion, i) =>
      filaHistorial(evento({ id: `e${i}`, accion, actorId: `${i}1111111-1111-4111-8111-111111111111` }), sinCuentas),
    );
    for (const fila of filas) {
      expect(fila.usuario).toBe(t.usuarioNoDisponible);
      expect(visible(fila)).not.toMatch(UUID);
    }
  });
});

describe("nombresDeActores", () => {
  it("names an account by its name, else its email, as Usuarios does", () => {
    const nombres = nombresDeActores([
      { id: "a", nombre: "Ana Pérez", email: "ana@mitsm.test" },
      { id: "b", nombre: null, email: "beto@mitsm.test" },
    ]);
    expect([...nombres]).toEqual([
      ["a", "Ana Pérez"],
      ["b", "beto@mitsm.test"],
    ]);
  });
});

// The Usuarios account history (CR-2, carried over from AUDCR1-01) shows its
// actors through the same helper.
describe("nombreDeActor", () => {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  it("names a known actor and never shows an unknown one's id", () => {
    const otro = "22222222-2222-4222-8222-222222222222";
    const lista = nombresDeActores([
      { id: ACTOR, nombre: null, email: "ana@example.test" },
      { id: otro, nombre: "  ", email: " " },
    ]);
    expect(nombreDeActor(lista, ACTOR)).toBe("ana@example.test");
    for (const id of [otro, "33333333-3333-4333-8333-333333333333"]) {
      expect(nombreDeActor(lista, id)).toBe(t.usuarioNoDisponible);
      expect(nombreDeActor(lista, id)).not.toMatch(UUID);
    }
    // The account lookup failed: nobody can be named.
    expect(nombreDeActor(nombresDeActores([]), ACTOR)).toBe(t.usuarioNoDisponible);
  });
});
