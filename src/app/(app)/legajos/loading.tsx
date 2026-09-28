import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { copy } from "@/lib/copy/es-AR";

export default function LegajosLoading() {
  return (
    <>
      <PageHeader kicker={copy.legajos.kicker} title={copy.legajos.title} />
      <div className="px-[34px] pb-10 pt-[26px]">
        <Panel>
          <p role="status" className="text-ink-soft">
            {copy.legajos.loading}
          </p>
        </Panel>
      </div>
    </>
  );
}
