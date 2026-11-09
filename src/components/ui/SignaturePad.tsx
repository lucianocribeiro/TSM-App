"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, type PointerEvent, type Ref } from "react";
import { contarTinta, dibujoSuficiente, distancia } from "@/lib/recibos/dibujo";
import { cx } from "./cx";

export type SignaturePadHandle = {
  // The drawing as a PNG (paper and ink colors from the --firma-* tokens).
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
};

export type SignaturePadProps = {
  // The canvas's accessible name.
  label: string;
  // Whether the drawing meets the minimum (src/lib/recibos/dibujo.ts).
  onChange: (suficiente: boolean) => void;
  ref?: Ref<SignaturePadHandle>;
  className?: string;
};

const ALTO_CSS = 180;
const ANCHO_MAX_CSS = 600;
// At most 3 device pixels per CSS pixel: the PNG stays within 1800 x 540.
const DPR_MAX = 3;

// A drawing surface on <canvas> with Pointer Events: mouse, touch and pen.
// touch-action: none keeps the page from scrolling while drawing. High-DPI
// aware; fits its container's width (up to 600px). Resizing clears it.
export function SignaturePad({ label, onChange, ref, className }: SignaturePadProps) {
  const contenedor = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const estado = useRef({ dibujando: false, ultimo: { x: 0, y: 0 }, largo: 0, dpr: 1 });
  // The latest callback, so a new one from the parent never resets the pad.
  const avisar = useRef(onChange);
  useEffect(() => {
    avisar.current = onChange;
  }, [onChange]);

  const colores = useCallback(() => {
    const estilos = getComputedStyle(document.documentElement);
    return {
      fondo: estilos.getPropertyValue("--firma-fondo").trim(),
      tinta: estilos.getPropertyValue("--firma-tinta").trim(),
    };
  }, []);

  const pintarPapel = useCallback(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colores().fondo;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(estado.current.dpr, 0, 0, estado.current.dpr, 0, 0);
  }, [colores]);

  const limpiar = useCallback(() => {
    estado.current.largo = 0;
    estado.current.dibujando = false;
    pintarPapel();
    avisar.current(false);
  }, [pintarPapel]);

  // Size to the container, in device pixels.
  useEffect(() => {
    const c = canvas.current;
    const caja = contenedor.current;
    if (!c || !caja) return;
    const ajustar = () => {
      const ancho = Math.min(ANCHO_MAX_CSS, Math.floor(caja.clientWidth));
      if (ancho <= 0) return;
      const dpr = Math.min(DPR_MAX, Math.max(1, window.devicePixelRatio || 1));
      estado.current.dpr = dpr;
      c.style.width = `${ancho}px`;
      c.style.height = `${ALTO_CSS}px`;
      c.width = Math.round(ancho * dpr);
      c.height = Math.round(ALTO_CSS * dpr);
      limpiar();
    };
    ajustar();
    const observador = new ResizeObserver(ajustar);
    observador.observe(caja);
    return () => observador.disconnect();
  }, [limpiar]);

  useImperativeHandle(
    ref,
    () => ({
      clear: limpiar,
      toBlob: () => new Promise((resolve) => (canvas.current ? canvas.current.toBlob(resolve, "image/png") : resolve(null))),
    }),
    [limpiar],
  );

  function punto(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function empezar(event: PointerEvent<HTMLCanvasElement>) {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = punto(event);
    estado.current.dibujando = true;
    estado.current.ultimo = p;
    ctx.strokeStyle = colores().tinta;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function mover(event: PointerEvent<HTMLCanvasElement>) {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !estado.current.dibujando) return;
    const p = punto(event);
    estado.current.largo += distancia(estado.current.ultimo, p);
    estado.current.ultimo = p;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function terminar() {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !estado.current.dibujando) return;
    estado.current.dibujando = false;
    const tinta = contarTinta(ctx.getImageData(0, 0, c.width, c.height).data);
    // Ink is counted in device pixels: compare it at CSS scale.
    const dpr2 = estado.current.dpr * estado.current.dpr;
    avisar.current(dibujoSuficiente({ largoTrazo: estado.current.largo, pixelesTinta: tinta / dpr2 }));
  }

  return (
    <div ref={contenedor} className={cx("w-full", className)}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={label}
        data-testid="signature-pad"
        className="block cursor-crosshair touch-none rounded-md border border-line"
        onPointerDown={empezar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerCancel={terminar}
        onPointerLeave={terminar}
      />
    </div>
  );
}
