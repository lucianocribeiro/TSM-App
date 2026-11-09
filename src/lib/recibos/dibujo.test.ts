import { describe, expect, it } from "vitest";
import { contarTinta, DIBUJO_MINIMO, dibujoSuficiente, distancia } from "./dibujo";

// RGBA pixels: n of ink (dark, opaque), the rest paper (white).
function pixeles(tinta: number, total: number): Uint8ClampedArray {
  const datos = new Uint8ClampedArray(total * 4).fill(255);
  for (let i = 0; i < tinta; i++) datos.set([0, 7, 46, 255], i * 4);
  return datos;
}

describe("minimum drawing (decision 13)", () => {
  it("needs both enough stroke and enough ink", () => {
    const { largoTrazoPx: largo, pixelesTinta: tinta } = DIBUJO_MINIMO;
    expect(dibujoSuficiente({ largoTrazo: largo, pixelesTinta: tinta })).toBe(true);
    expect(dibujoSuficiente({ largoTrazo: largo - 1, pixelesTinta: tinta * 10 })).toBe(false);
    expect(dibujoSuficiente({ largoTrazo: largo * 10, pixelesTinta: tinta - 1 })).toBe(false);
    expect(dibujoSuficiente({ largoTrazo: 0, pixelesTinta: 0 })).toBe(false);
  });

  it("counts only opaque pixels darker than paper", () => {
    expect(contarTinta(pixeles(0, 100))).toBe(0);
    expect(contarTinta(pixeles(37, 100))).toBe(37);
    // Transparent dark pixels and light grey do not count.
    expect(contarTinta(new Uint8ClampedArray([0, 0, 0, 0, 230, 230, 230, 255]))).toBe(0);
  });

  it("measures stroke travel between pointer positions", () => {
    expect(distancia({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
