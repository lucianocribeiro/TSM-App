import { describe, expect, it } from "vitest";
import { resumirDocumentos, type DocumentoFila } from "./resumen";

function fila(overrides: Partial<DocumentoFila>): DocumentoFila {
  return {
    id: overrides.id ?? "id",
    tipo: "dni_frente",
    estado: "aprobado",
    fileName: "dni.pdf",
    creadoEn: "2026-01-01T10:00:00Z",
    motivoRechazo: null,
    ...overrides,
  };
}

function porTipo(filas: DocumentoFila[]) {
  return Object.fromEntries(resumirDocumentos(filas).map((resumen) => [resumen.tipo, resumen]));
}

describe("resumirDocumentos", () => {
  it("lists every type in order, missing when there is nothing, with the required flag", () => {
    const resumen = resumirDocumentos([]);
    expect(resumen.map((r) => [r.tipo, r.estado, r.requerido, r.puedeSubir])).toEqual([
      ["dni_frente", "faltante", true, true],
      ["dni_dorso", "faltante", true, true],
      ["licencia_conducir", "faltante", false, true],
    ]);
  });

  it("shows the approved file", () => {
    const r = porTipo([fila({ id: "a" })]).dni_frente;
    expect(r).toMatchObject({ estado: "aprobado", puedeSubir: true, pendiente: null, rechazado: null });
    expect(r.vigente?.id).toBe("a");
  });

  it("shows a pending upload first, keeps the approved one as current, and blocks another upload", () => {
    const r = porTipo([fila({ id: "a" }), fila({ id: "p", estado: "pendiente", creadoEn: "2026-02-01T10:00:00Z" })]).dni_frente;
    expect(r.estado).toBe("pendiente");
    expect(r.vigente?.id).toBe("a");
    expect(r.pendiente?.id).toBe("p");
    expect(r.puedeSubir).toBe(false);
  });

  it("shows a rejection only when it is the latest upload", () => {
    const rechazo = fila({ id: "r", estado: "rechazado", motivoRechazo: "Borrosa", creadoEn: "2026-02-01T10:00:00Z" });
    const latest = porTipo([fila({ id: "a" }), rechazo]).dni_frente;
    expect(latest.estado).toBe("rechazado");
    expect(latest.rechazado?.motivoRechazo).toBe("Borrosa");
    expect(latest.vigente?.id).toBe("a");
    expect(latest.puedeSubir).toBe(true);

    const older = porTipo([rechazo, fila({ id: "a2", creadoEn: "2026-03-01T10:00:00Z" })]).dni_frente;
    expect(older.estado).toBe("aprobado");
    expect(older.rechazado).toBeNull();
  });

  it("ignores replaced files", () => {
    const r = porTipo([fila({ id: "old", estado: "reemplazado" }), fila({ id: "new", creadoEn: "2026-02-01T10:00:00Z" })]).dni_frente;
    expect(r.vigente?.id).toBe("new");
    expect(porTipo([fila({ estado: "reemplazado" })]).dni_frente.estado).toBe("faltante");
  });
});
