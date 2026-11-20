import { SegmentedNav } from "@/components/ui/SegmentedNav";
import { copyRecibos } from "@/lib/copy/recibos";

// The two views of /recibos (F2-06, decision 5): Carga and Estado de firmas,
// on the same period.
export function VistasRecibos({ actual, periodoId }: { actual: "carga" | "estado"; periodoId: string | null }) {
  const consulta = periodoId ? `?periodo=${periodoId}` : "";
  return (
    <SegmentedNav
      label={copyRecibos.vistas.label}
      actual={actual}
      items={[
        { key: "carga", href: `/recibos${consulta}`, label: copyRecibos.vistas.carga },
        { key: "estado", href: `/recibos/estado${consulta}`, label: copyRecibos.vistas.estado },
      ]}
    />
  );
}
