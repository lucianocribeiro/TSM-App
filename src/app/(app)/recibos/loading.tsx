import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { copyRecibos } from "@/lib/copy/recibos";

export default function RecibosLoading() {
  return (
    <>
      <PageHeader kicker={copyRecibos.kicker} title={copyRecibos.title} />
      <div className="px-[34px] pb-10 pt-[26px]">
        <Panel>
          <p role="status" className="text-ink-soft">
            {copyRecibos.acciones.procesando}
          </p>
        </Panel>
      </div>
    </>
  );
}
