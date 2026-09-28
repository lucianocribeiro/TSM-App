import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { copy } from "@/lib/copy/es-AR";

const t = copy.aprobaciones.bandeja;

export default function AprobacionesLoading() {
  return (
    <>
      <PageHeader kicker={t.kicker} title={t.title} />
      <div className="px-[34px] pb-10 pt-[26px]">
        <Panel>
          <p role="status" className="text-ink-soft">
            {t.loading}
          </p>
        </Panel>
      </div>
    </>
  );
}
