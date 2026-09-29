import { ACTIVIDAD_THROTTLE_MS, AVISO_MS, INACTIVIDAD_MS } from "./tiempos";

// The browser side of the inactivity limit (PRD session rules). The server
// enforces the same limit on its own (src/lib/sesion/marca.ts); this side
// warns the user and signs out on time. Tabs share the last activity through
// localStorage, so input in any tab counts for all of them, and a sign-out in
// one tab reaches the others through the same storage events.

export const ULTIMA_ACTIVIDAD_KEY = "tsm-ultima-actividad";
export const SALIDA_KEY = "tsm-salida";

export type Fase = { fase: "activa" } | { fase: "aviso"; restanteMs: number } | { fase: "vencida" };

// Where a session stands, from its last activity.
export function faseInactividad(ultimaActividad: number, ahora: number): Fase {
  const inactivo = Math.max(0, ahora - ultimaActividad);
  if (inactivo >= INACTIVIDAD_MS) return { fase: "vencida" };
  if (inactivo >= AVISO_MS) return { fase: "aviso", restanteMs: INACTIVIDAD_MS - inactivo };
  return { fase: "activa" };
}

// "m:ss" for the countdown.
export function formatoRestante(ms: number): string {
  const segundos = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

export type Almacen = {
  leer: (clave: string) => string | null;
  escribir: (clave: string, valor: string) => void;
};

export type RelojOpciones = {
  ahora: () => number;
  almacen: Almacen;
  // The phase changed (or the countdown moved while warning).
  alCambiar: (fase: Fase) => void;
  // The limit was reached here: sign out.
  alVencer: () => void;
  // Real input was recorded: report it to the server (throttled).
  alReportar: () => void;
  // False while a forced password change is pending: the server then renews
  // the session only on page loads of /cambiar-password, so input neither
  // resets the timer nor is reported. Default true.
  contarEntrada?: boolean;
  intervaloMs?: number;
};

// Tracks the last activity (shared between tabs) and ticks once a second.
// Input while the warning is open does not count: only "Seguir conectado"
// (continuar) resets it, so the user sees and answers the warning.
export class RelojInactividad {
  private readonly o: RelojOpciones;
  private ultimaLocal = 0;
  private ultimoRegistro = Number.NEGATIVE_INFINITY;
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private fase: Fase = { fase: "activa" };
  private terminado = false;

  constructor(opciones: RelojOpciones) {
    this.o = opciones;
  }

  iniciar(): void {
    const ahora = this.o.ahora();
    // A page load is a navigation: user activity the server has already
    // counted, so it is not reported again.
    this.registrar(ahora, false);
    this.temporizador = setInterval(() => this.tick(), this.o.intervaloMs ?? 1000);
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
  }

  // The latest activity of any tab.
  ultimaActividad(): number {
    const compartida = Number(this.o.almacen.leer(ULTIMA_ACTIVIDAD_KEY));
    return Math.max(this.ultimaLocal, Number.isFinite(compartida) ? compartida : 0);
  }

  // Real user input (pointer, keyboard, touch, scroll), throttled.
  actividad(): void {
    if (this.o.contarEntrada === false) return;
    if (this.terminado || this.fase.fase !== "activa") return;
    const ahora = this.o.ahora();
    if (ahora - this.ultimoRegistro < ACTIVIDAD_THROTTLE_MS) return;
    this.registrar(ahora, true);
  }

  // "Seguir conectado". Without contarEntrada the caller renews the session
  // with a navigation instead, so nothing is reported.
  continuar(): void {
    if (this.terminado) return;
    this.registrar(this.o.ahora(), this.o.contarEntrada !== false);
    this.tick();
  }

  // Another tab wrote an activity or a sign-out: re-evaluate now.
  sincronizar(): void {
    this.tick();
  }

  tick(): void {
    if (this.terminado) return;
    const fase = faseInactividad(this.ultimaActividad(), this.o.ahora());
    if (fase.fase === "vencida") {
      this.terminado = true;
      this.detener();
      this.cambiar(fase);
      this.o.alVencer();
      return;
    }
    this.cambiar(fase);
  }

  private cambiar(fase: Fase): void {
    const igual =
      fase.fase === this.fase.fase &&
      (fase.fase !== "aviso" || (this.fase.fase === "aviso" && Math.ceil(fase.restanteMs / 1000) === Math.ceil(this.fase.restanteMs / 1000)));
    this.fase = fase;
    if (!igual) this.o.alCambiar(fase);
  }

  private registrar(ahora: number, reportar: boolean): void {
    this.ultimaLocal = ahora;
    this.ultimoRegistro = ahora;
    this.o.almacen.escribir(ULTIMA_ACTIVIDAD_KEY, String(ahora));
    if (reportar) this.o.alReportar();
  }
}
