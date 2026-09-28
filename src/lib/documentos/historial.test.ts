import { describe, expect, it } from "vitest";
import { historialDocumentos, reemplazantes } from "./historial";
import type { DocumentoFila } from "./resumen";

const fila = (over: Partial<DocumentoFila>): DocumentoFila => ({
  id: "x",
  tipo: "dni_frente",
  estado: "reemplazado",
  fileName: "f.pdf",
  creadoEn: "2026-01-01T10:00:00Z",
  motivoRechazo: null,
  reemplazadoEn: null,
  reemplazadoPor: null,
  ...over,
});

describe("historialDocumentos", () => {
  const filas = [
    fila({ id: "vigente", estado: "aprobado" }),
    fila({ id: "viejo", reemplazadoEn: "2026-02-01T10:00:00Z", reemplazadoPor: "admin-1" }),
    fila({ id: "mas-viejo", creadoEn: "2025-06-01T10:00:00Z" }),
    fila({ id: "reciente", reemplazadoEn: "2026-03-01T10:00:00Z", reemplazadoPor: "admin-2" }),
    fila({ id: "licencia", tipo: "licencia_conducir", reemplazadoEn: "2026-01-05T10:00:00Z", reemplazadoPor: "admin-1" }),
    fila({ id: "rechazado", tipo: "dni_dorso", estado: "rechazado" }),
  ];

  it("lists replaced versions per type, newest first, only for types with history", () => {
    const historial = historialDocumentos(filas, new Map([["admin-1", "Ana Admin"]]));
    expect(historial.map((grupo) => grupo.tipo)).toEqual(["dni_frente", "licencia_conducir"]);
    expect(historial[0].versiones.map((version) => version.id)).toEqual(["reciente", "viejo", "mas-viejo"]);
  });

  it("names who replaced each version when known", () => {
    const [frente] = historialDocumentos(filas, new Map([["admin-1", "Ana Admin"]]));
    expect(frente.versiones.map((version) => version.reemplazadoPor)).toEqual([null, "Ana Admin", null]);
  });

  it("collects who replaced something", () => {
    expect(reemplazantes(filas).sort()).toEqual(["admin-1", "admin-2"]);
    expect(reemplazantes([fila({ estado: "aprobado", reemplazadoPor: "admin-9" })])).toEqual([]);
  });
});
