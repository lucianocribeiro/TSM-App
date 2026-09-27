import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { copy } from "@/lib/copy/es-AR";

export default function UsuariosLoading() {
  return (
    <>
      <PageHeader kicker={copy.usuarios.kicker} title={copy.usuarios.title} />
      <div className="px-[34px] pb-10 pt-[26px]">
        <Panel>
          <p role="status" className="text-ink-soft">
            {copy.usuarios.loading}
          </p>
        </Panel>
      </div>
    </>
  );
}
