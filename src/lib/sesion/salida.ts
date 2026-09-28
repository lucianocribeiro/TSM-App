import { SALIDA_KEY } from "./reloj";

// Tells the other open tabs that this one is signing out, so they leave too
// (they listen for storage events on SALIDA_KEY).

export type MotivoSalidaTab = "manual" | "inactividad";

export function anunciarSalida(motivo: MotivoSalidaTab): void {
  try {
    window.localStorage.setItem(SALIDA_KEY, JSON.stringify({ motivo, en: Date.now() }));
  } catch {
    // Storage unavailable: the other tabs are refused on their next request.
  }
}

export function leerSalida(valor: string | null): MotivoSalidaTab | null {
  if (!valor) return null;
  try {
    const { motivo } = JSON.parse(valor) as { motivo?: unknown };
    return motivo === "inactividad" || motivo === "manual" ? motivo : null;
  } catch {
    return null;
  }
}
