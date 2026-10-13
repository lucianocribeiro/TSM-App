import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { mensajeBase, mensajeNombre } from "./errores";

const errors = copy.configuracion.errors;

describe("mensajeNombre", () => {
  it("maps each name error, with the Puesto wording for a duplicate Puesto", () => {
    expect(mensajeNombre("vacio", "area")).toBe(errors.nombreVacio);
    expect(mensajeNombre("largo", "tarea")).toBe(errors.nombreLargo);
    expect(mensajeNombre("duplicado", "sucursal")).toBe(errors.nombreDuplicado);
    expect(mensajeNombre("duplicado", "puesto")).toBe(errors.nombreDuplicadoPuesto);
  });
});

describe("mensajeBase", () => {
  it("maps database refusals to controlled es-AR messages", () => {
    expect(mensajeBase({ code: "23505" }, "convenio")).toBe(errors.nombreDuplicado);
    expect(mensajeBase({ code: "23505" }, null)).toBe(errors.cambioConcurrente);
    expect(mensajeBase({ code: "23503" }, null)).toBe(errors.enUso);
    expect(mensajeBase({ code: "P0002" }, null)).toBe(errors.noEncontrado);
    expect(mensajeBase({ code: "55000", hint: "version" }, null)).toBe(errors.cambioConcurrente);
    expect(mensajeBase({ code: "55000", hint: "extremo" }, null)).toBe(errors.extremo);
    expect(mensajeBase({ code: "55000", hint: "item_sistema" }, null)).toBe(errors.itemSistema);
    expect(mensajeBase({ code: "23514", hint: "item_inactivo" }, null)).toBe(errors.sucursalInvalida);
    expect(mensajeBase({ code: "23514" }, "sucursal")).toBe(errors.accionFallo);
  });

  it("never passes a database message through", () => {
    for (const error of [{ code: "42501" }, { code: "55000", hint: "lista_fija" }, { code: "XX000" }, {}]) {
      expect(mensajeBase(error, "area")).toBe(errors.accionFallo);
    }
  });
});
