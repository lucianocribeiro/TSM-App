import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { getSessionUser } from "@/lib/auth/session";
import { copy } from "@/lib/copy/es-AR";
import { resumirDocumentos } from "@/lib/documentos/resumen";
import { cargarMiLegajo } from "@/lib/legajo/mi-legajo";
import { datosLaboralesVista, legajoVacio } from "@/lib/legajo/vista";
import { MiLegajoScreen } from "./MiLegajoScreen";

const t = copy.miLegajo;

// Mi Legajo (PRD US-3, US-7): the signed-in user's own legajo, read with their
// session. There is no id in the URL: nobody can ask for another legajo here.
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
      laborales={datosLaboralesVista(legajo)}
      documentos={resumirDocumentos(data.documentos)}
      esAdmin={user.role === "admin"}
      vacio={legajoVacio(legajo, data.hijos)}
    />
  );
}
