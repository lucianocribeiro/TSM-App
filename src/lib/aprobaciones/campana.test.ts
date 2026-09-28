import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { etiquetaCampana, textoCampana, totalPendientes } from "./campana";

describe("bell", () => {
  it("adds requests and documents", () => {
    expect(totalPendientes({ solicitudes: 2, documentos: 3 })).toBe(5);
    expect(totalPendientes({ solicitudes: 0, documentos: 0 })).toBe(0);
  });

  it("shows nothing at zero, the number up to 9, then 9+", () => {
    expect(textoCampana(0)).toBeNull();
    expect(textoCampana(-1)).toBeNull();
    expect(textoCampana(Number.NaN)).toBeNull();
    expect(textoCampana(1)).toBe("1");
    expect(textoCampana(9)).toBe("9");
    expect(textoCampana(10)).toBe(copy.campana.tope);
    expect(textoCampana(250)).toBe("9+");
  });

  it("names the exact count for assistive technology", () => {
    expect(etiquetaCampana(0)).toBe(copy.campana.sinPendientes);
    expect(etiquetaCampana(12)).toBe("Aprobaciones: 12 pendientes");
  });
});
