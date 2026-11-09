import { describe, expect, it } from "vitest";
import { MOTIVOS_DNI, pasoSiguiente, responder, type Paso } from "./carga-flujo";

describe("pasoSiguiente", () => {
  it("maps each registration outcome to the next step", () => {
    expect(pasoSiguiente({ estado: "registrado", reciboId: "r" })).toEqual({ tipo: "listo", reciboId: "r" });
    expect(pasoSiguiente({ estado: "confirmar_dni", motivo: "dni_no_encontrado" })).toEqual({ tipo: "dialogo_dni", motivo: "dni_no_encontrado" });
    expect(pasoSiguiente({ estado: "confirmar_dni", motivo: "no_verificable", detalle: "sin_texto" })).toEqual({
      tipo: "dialogo_dni",
      motivo: "no_verificable",
      detalle: "sin_texto",
    });
    expect(pasoSiguiente({ estado: "confirmar_reemplazo", firmado: true })).toEqual({ tipo: "dialogo_reemplazo", firmado: true });
  });
});

describe("responder", () => {
  const dni: Paso = { tipo: "dialogo_dni", motivo: "sin_dni" };
  const reemplazo: Paso = { tipo: "dialogo_reemplazo", firmado: false };

  it("Aceptar confirms the DNI motivo shown, and only that one", () => {
    expect(responder({}, dni, true)).toEqual({ confirmarDni: "sin_dni" });
  });

  it("Reemplazar keeps the earlier DNI answer: the DNI comes first, then the replacement", () => {
    const tras = responder({}, dni, true);
    expect(tras).not.toBe("descartar");
    expect(responder(tras as Exclude<typeof tras, "descartar">, reemplazo, true)).toEqual({ confirmarDni: "sin_dni", confirmarReemplazo: true });
  });

  it("Rechazar and Cancelar discard the uploaded file", () => {
    expect(responder({}, dni, false)).toBe("descartar");
    expect(responder({ confirmarDni: "sin_dni" }, reemplazo, false)).toBe("descartar");
  });

  it("a finished step changes nothing", () => {
    expect(responder({ confirmarReemplazo: true }, { tipo: "listo", reciboId: "r" }, true)).toEqual({ confirmarReemplazo: true });
  });

  it("the motivos are the database override reasons", () => {
    expect(MOTIVOS_DNI).toEqual(["dni_no_encontrado", "no_verificable", "sin_dni"]);
  });
});
