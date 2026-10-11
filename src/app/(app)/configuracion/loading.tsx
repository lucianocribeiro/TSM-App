import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { copy } from "@/lib/copy/es-AR";

export default function ConfiguracionLoading() {
  return (
    <>
      <PageHeader kicker={copy.configuracion.kicker} title={copy.configuracion.title} />
      <div className="px-[34px] pb-10 pt-[26px]">
        <Panel>
          <p role="status" className="text-ink-soft">
            {copy.configuracion.loading}
          </p>
        </Panel>
      </div>
    </>
  );
}
