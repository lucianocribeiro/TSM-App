// The minimum drawing of a signature (F2-05, decision 13). Pure, shared by
// the signature pad: "Guardar firma" stays disabled until the drawing has
// both enough stroke (total pointer travel while pressed, in CSS pixels)
// and enough ink (pixels that are not paper). A dot, a short dash or a few
// taps do not pass.

export const DIBUJO_MINIMO = { largoTrazoPx: 150, pixelesTinta: 400 } as const;

export type MedidaDibujo = { largoTrazo: number; pixelesTinta: number };

export function dibujoSuficiente(medida: MedidaDibujo): boolean {
  return medida.largoTrazo >= DIBUJO_MINIMO.largoTrazoPx && medida.pixelesTinta >= DIBUJO_MINIMO.pixelesTinta;
}

// Ink pixels of RGBA data on white paper: opaque and clearly darker than paper.
export function contarTinta(rgba: Uint8ClampedArray, umbral = 200): number {
  let tinta = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 0 && (rgba[i] < umbral || rgba[i + 1] < umbral || rgba[i + 2] < umbral)) tinta++;
  }
  return tinta;
}

export function distancia(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
