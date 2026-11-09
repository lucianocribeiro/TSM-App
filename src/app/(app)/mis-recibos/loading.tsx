import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { copyMisRecibos } from "@/lib/copy/mis-recibos";

export default function MisRecibosLoading() {
  return (
    <>
      <PageHeader kicker={copyMisRecibos.kicker} title={copyMisRecibos.title} />
      <div className="px-[34px] pb-10 pt-[26px]">
        <Panel>
          <p role="status" className="text-ink-soft">
            {copyMisRecibos.acciones.abriendo}
          </p>
        </Panel>
      </div>
    </>
  );
}
