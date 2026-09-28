import type { GrupoEditable } from "./grupos";

// While an employee has a pending change request, an Admin does not edit
// groups A to D (children included) directly: the request is resolved first
// (F1-09A decision). Group E and documents stay editable. The /legajos
// actions enforce the same rule on the server (tieneSolicitudPendiente).
export function grupoBloqueado(grupo: GrupoEditable | "E", solicitudPendiente: boolean): boolean {
  return solicitudPendiente && grupo !== "E";
}
