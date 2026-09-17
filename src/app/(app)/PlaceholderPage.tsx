import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { copy } from "@/lib/copy/es-AR";

type PlaceholderPageProps = {
  kicker: string;
  title: string;
};

// Placeholder content until the module is built. No data.
export function PlaceholderPage({ kicker, title }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader kicker={kicker} title={title} />
      <div className="px-[34px] pb-10 pt-[26px]">
        <Panel>
          <p className="text-ink-soft">{copy.common.comingSoon}</p>
        </Panel>
      </div>
    </>
  );
}
