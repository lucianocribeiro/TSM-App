import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { getSessionUser } from "@/lib/auth/session";
import { copy } from "@/lib/copy/es-AR";
import { resumirDocumentos } from "@/lib/documentos/resumen";
import { cargarMiLegajo } from "@/lib/legajo/mi-legajo";
import { legajoVacio } from "@/lib/legajo/vista";
import { MiLegajoScreen } from "./MiLegajoScreen";

const t = copy.miLegajo;

// Mi Legajo (PRD US-3, US-7): the signed-in user's own legajo, read with their
// session. There is no id in the URL: nobody can ask for another legajo here.
// Groups A to D only: group E (datos laborales) is Admin only and lives in
// its own table, which this page never reads (an Admin edits their own from
// Legajos).
export default async function MiLegajoPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const data = await cargarMiLegajo(user.id);
  if (!data) {
    return (
      <>
        <PageHeader kicker={t.kicker} title={t.title} />
        <div className="px-[34px] pb-10 pt-[26px]">
          <Panel>
            <p role="alert" className="text-accent-deep">
              {copy.aprobaciones.errors.guardarFallo}
            </p>
          </Panel>
        </div>
      </>
    );
  }

  const { legajo } = data;
  return (
    <MiLegajoScreen
      actual={{ ...legajo, hijos: data.hijos }}
      solicitud={data.solicitud}
      documentos={resumirDocumentos(data.documentos)}
      esAdmin={user.role === "admin"}
      vacio={legajoVacio(legajo, data.hijos)}
    />
  );
}
