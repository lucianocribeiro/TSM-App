import { CAMPOS_SOLICITUD, type CampoGrupo, type CampoSolicitud } from "@/lib/aprobaciones/campos";
import {
  datosEmergenciaSchema,
  datosFamiliaresSchema,
  datosPersonalesSchema,
  domicilioContactoSchema,
} from "./validation";

// The editable groups of the legajo (PRD 5.1 to 5.4): their validation schema
// and their fields, in page order. Group E (5.5) is read only for the
// Empleado and has no entry here.
export type GrupoEditable = CampoGrupo;
export const GRUPOS_EDITABLES: readonly GrupoEditable[] = ["A", "B", "C", "D"];

export const ESQUEMA_GRUPO = {
  A: datosPersonalesSchema,
  B: domicilioContactoSchema,
  C: datosFamiliaresSchema,
  D: datosEmergenciaSchema,
} as const;

export function camposDelGrupo(grupo: GrupoEditable): CampoSolicitud[] {
  return CAMPOS_SOLICITUD.filter((config) => config.grupo === grupo).map((config) => config.campo);
}

export function isGrupoEditable(value: unknown): value is GrupoEditable {
  return typeof value === "string" && (GRUPOS_EDITABLES as readonly string[]).includes(value);
}
