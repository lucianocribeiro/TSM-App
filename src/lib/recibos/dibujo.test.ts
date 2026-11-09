import { describe, expect, it } from "vitest";
import { contarTinta, DIBUJO_MINIMO, dibujoSuficiente, distancia } from "./dibujo";

// RGBA pixels on a transparent canvas: n of ink (opaque), the rest empty.
function pixeles(tinta: number, total: number): Uint8ClampedArray {
  const datos = new Uint8ClampedArray(total * 4).fill(0);
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

  it("counts every pixel with alpha, and no transparent one (F2-05-FIX-01)", () => {
    expect(contarTinta(pixeles(0, 100))).toBe(0);
    expect(contarTinta(pixeles(37, 100))).toBe(37);
    // A transparent pixel does not count, whatever its colour; any alpha does
    // (the strokes are anti-aliased at their edges).
    expect(contarTinta(new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 0]))).toBe(0);
    expect(contarTinta(new Uint8ClampedArray([230, 230, 230, 255, 0, 7, 46, 40]))).toBe(2);
  });

  it("measures stroke travel between pointer positions", () => {
    expect(distancia({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
