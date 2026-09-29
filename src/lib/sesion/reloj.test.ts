import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { faseInactividad, formatoRestante, RelojInactividad, SALIDA_KEY, ULTIMA_ACTIVIDAD_KEY, type Fase } from "./reloj";
import { ACTIVIDAD_THROTTLE_MS, AVISO_MS, INACTIVIDAD_MS } from "./tiempos";

const MIN = 60 * 1000;

describe("faseInactividad", () => {
  it("is active until 13 minutes, warns until 15, then expires", () => {
    expect(faseInactividad(0, 12 * MIN)).toEqual({ fase: "activa" });
    expect(faseInactividad(0, AVISO_MS)).toEqual({ fase: "aviso", restanteMs: 2 * MIN });
    expect(faseInactividad(0, 14 * MIN + 30_000)).toEqual({ fase: "aviso", restanteMs: 30_000 });
    expect(faseInactividad(0, INACTIVIDAD_MS)).toEqual({ fase: "vencida" });
  });

  it("formats the countdown", () => {
    expect(formatoRestante(2 * MIN)).toBe("2:00");
    expect(formatoRestante(61_500)).toBe("1:02");
    expect(formatoRestante(0)).toBe("0:00");
  });
});

describe("RelojInactividad (fake timers)", () => {
  let store: Map<string, string>;
  let fases: Fase[];
  let vencido: Mock<() => void>;
  let reportes: Mock<() => void>;
  let reloj: RelojInactividad;

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    store = new Map();
    fases = [];
    vencido = vi.fn<() => void>();
    reportes = vi.fn<() => void>();
    reloj = new RelojInactividad({
      ahora: () => Date.now(),
      almacen: { leer: (k) => store.get(k) ?? null, escribir: (k, v) => void store.set(k, v) },
      alCambiar: (fase) => fases.push(fase),
      alVencer: vencido,
      alReportar: reportes,
    });
    reloj.iniciar();
  });

  afterEach(() => {
    reloj.detener();
    vi.useRealTimers();
  });

  const ultimaFase = () => fases.at(-1)?.fase ?? "activa";

  it("warns at 13 minutes and signs out at 15", () => {
    vi.advanceTimersByTime(13 * MIN - 1000);
    expect(ultimaFase()).toBe("activa");
    vi.advanceTimersByTime(1000);
    expect(ultimaFase()).toBe("aviso");
    vi.advanceTimersByTime(2 * MIN - 1000);
    expect(vencido).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(ultimaFase()).toBe("vencida");
    expect(vencido).toHaveBeenCalledTimes(1);
    // Once: the timer stops.
    vi.advanceTimersByTime(10 * MIN);
    expect(vencido).toHaveBeenCalledTimes(1);
  });

  it("the page load counts as activity but is not reported again", () => {
    expect(store.get(ULTIMA_ACTIVIDAD_KEY)).toBe(String(Date.now()));
    expect(reportes).not.toHaveBeenCalled();
  });

  it("resets on activity, reports it, and throttles repeated input", () => {
    vi.advanceTimersByTime(10 * MIN);
    reloj.actividad();
    expect(reportes).toHaveBeenCalledTimes(1);
    reloj.actividad();
    vi.advanceTimersByTime(ACTIVIDAD_THROTTLE_MS - 1000);
    reloj.actividad();
    expect(reportes).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    reloj.actividad();
    expect(reportes).toHaveBeenCalledTimes(2);
    // 13 minutes from the first recorded input, not from the page load.
    vi.advanceTimersByTime(12 * MIN);
    expect(ultimaFase()).toBe("activa");
    vi.advanceTimersByTime(MIN);
    expect(ultimaFase()).toBe("aviso");
  });

  it("ignores passive input during the warning; 'Seguir conectado' resets it", () => {
    vi.advanceTimersByTime(13 * MIN);
    expect(ultimaFase()).toBe("aviso");
    reloj.actividad();
    vi.advanceTimersByTime(1000);
    expect(ultimaFase()).toBe("aviso");
    reloj.continuar();
    expect(ultimaFase()).toBe("activa");
    expect(reportes).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(14 * MIN);
    expect(vencido).not.toHaveBeenCalled();
  });

  it("with contarEntrada: false (forced change), input neither resets nor is reported", () => {
    reloj.detener();
    const fases2: Fase[] = [];
    const reportes2 = vi.fn<() => void>();
    const vencido2 = vi.fn<() => void>();
    store.clear();
    const forzado = new RelojInactividad({
      ahora: () => Date.now(),
      almacen: { leer: (k) => store.get(k) ?? null, escribir: (k, v) => void store.set(k, v) },
      alCambiar: (fase) => fases2.push(fase),
      alVencer: vencido2,
      alReportar: reportes2,
      contarEntrada: false,
    });
    forzado.iniciar();
    vi.advanceTimersByTime(10 * MIN);
    forzado.actividad();
    vi.advanceTimersByTime(3 * MIN);
    expect(fases2.at(-1)?.fase).toBe("aviso");
    // "Seguir conectado" still resets locally (the page refresh renews the server), without reporting.
    forzado.continuar();
    expect(fases2.at(-1)?.fase).toBe("activa");
    vi.advanceTimersByTime(15 * MIN);
    expect(vencido2).toHaveBeenCalledTimes(1);
    expect(reportes2).not.toHaveBeenCalled();
    forzado.detener();
  });

  it("counts activity written by another tab", () => {
    vi.advanceTimersByTime(12 * MIN);
    store.set(ULTIMA_ACTIVIDAD_KEY, String(Date.now()));
    reloj.sincronizar();
    vi.advanceTimersByTime(12 * MIN);
    expect(ultimaFase()).toBe("activa");
    expect(vencido).not.toHaveBeenCalled();
    expect(store.has(SALIDA_KEY)).toBe(false);
  });
});
