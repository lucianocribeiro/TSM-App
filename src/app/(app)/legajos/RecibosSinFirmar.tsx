import { KpiStrip } from "@/components/ui/KpiStrip";
import { Panel } from "@/components/ui/Panel";
import { copy } from "@/lib/copy/es-AR";
import { contarEmpleadosConRecibosSinFirmar } from "@/lib/recibos/estado";

const t = copy.legajos.kpi;

// The one KPI card of Legajos (PRD Fase 2 RF-22, F2-06 decision 7): employees
// with at least one unsigned receipt in a published or closed period, any
// period. A server component streamed apart from the list (Suspense in the
// page), so a slow or failed count never holds or breaks the list. Zero is
// shown as 0.
export async function RecibosSinFirmar() {
  const valor = await contarEmpleadosConRecibosSinFirmar();
  if (valor === null) {
    return (
      <Panel>
        <p role="alert" className="text-[12.5px] italic text-accent-deep" data-testid="kpi-recibos-fallo">
          {t.fallo}
        </p>
      </Panel>
    );
  }
  return (
    <KpiStrip
      label={t.label}
      className="max-w-[360px]"
      items={[{ key: "recibos-sin-firmar", label: t.recibosSinFirmar, value: valor, link: { href: "/recibos/estado", label: t.verEstado } }]}
    />
  );
}

export function RecibosSinFirmarCargando() {
  return (
    <Panel className="max-w-[360px]">
      <p role="status" className="text-[12.5px] italic text-ink-soft" data-testid="kpi-recibos-cargando">
        {t.cargando}
      </p>
    </Panel>
  );
}
