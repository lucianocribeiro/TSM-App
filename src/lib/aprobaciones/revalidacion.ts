import { ESQUEMA_GRUPO } from "@/lib/legajo/grupos";
import { valorActual } from "@/lib/legajo/vista";
import { CAMPOS_SOLICITUD, isCampoSolicitud, type CampoSolicitud } from "./campos";
import { gruposDeSolicitud, type ItemSolicitud } from "./comparacion";
import { parseHijosValor, type LegajoActual } from "./solicitudes";

// Before approving a change request, its submitted values are validated again
// with the shared schemas of PRD 5.7: a rule may have changed since the
// employee sent it (for example the CUIL prefixes). Each touched group is
// validated as it would be after the approval (current values plus the
// submitted ones), and only problems in the submitted fields, or in the field
// a submitted one depends on, count: an old value the employee did not touch
// never blocks their request. Pure.

// Cross-field rules: a problem reported on the key also involves the value.
const RELACIONADOS: Partial<Record<CampoSolicitud, CampoSolicitud>> = {
  partido_otro: "partido",
  hijos: "tiene_hijos",
};

// A value in request text form as the group schema reads it.
function valorParaEsquema(campo: CampoSolicitud, texto: string | null): unknown {
  if (campo === "hijos") return parseHijosValor(texto) ?? texto;
  if (campo === "tiene_hijos") return texto === "true" ? true : texto === "false" ? false : texto;
  return texto;
}

export type Revalidacion = { ok: true } | { ok: false; campos: CampoSolicitud[] };

export function revalidarSolicitud(items: readonly ItemSolicitud[], actual: LegajoActual): Revalidacion {
  const propuestos = new Map(items.map((item) => [item.campo, item.valorPropuesto]));
  const enviados = new Set(items.map((item) => item.campo));
  const invalidos = new Set<CampoSolicitud>();

  for (const grupo of gruposDeSolicitud([...enviados])) {
    const valores: Record<string, unknown> = {};
    for (const { campo } of CAMPOS_SOLICITUD.filter((config) => config.grupo === grupo)) {
      const texto = propuestos.has(campo) ? (propuestos.get(campo) ?? null) : valorActual(actual, campo);
      valores[campo] = valorParaEsquema(campo, texto);
    }
    const parsed = ESQUEMA_GRUPO[grupo].safeParse(valores);
    if (parsed.success) continue;
    for (const issue of parsed.error.issues) {
      const campo = issue.path[0];
      if (!isCampoSolicitud(campo)) continue;
      const relacionado = RELACIONADOS[campo];
      if (enviados.has(campo) || (relacionado && enviados.has(relacionado))) invalidos.add(campo);
    }
  }

  if (invalidos.size === 0) return { ok: true };
  // Page order.
  return {
    ok: false,
    campos: CAMPOS_SOLICITUD.map((config): CampoSolicitud => config.campo).filter((campo) => invalidos.has(campo)),
  };
}
