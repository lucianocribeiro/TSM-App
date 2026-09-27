import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { getSessionUser } from "@/lib/auth/session";
import { copy } from "@/lib/copy/es-AR";
import { resumirDocumentos } from "@/lib/documentos/resumen";
import { formatearFecha, formatearPesos } from "@/lib/format/fecha";
import { calcularAntiguedad } from "@/lib/legajo/antiguedad";
import { hoyEnArgentina } from "@/lib/legajo/fechas";
import { cargarMiLegajo } from "@/lib/legajo/mi-legajo";
import { legajoVacio, textoAntiguedad } from "@/lib/legajo/vista";
import { MiLegajoScreen, type DatoLaboral } from "./MiLegajoScreen";

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
  const sinDato = (value: string) => value || t.sinDato;
  // Group E, formatted on the server (antigüedad as of today in Argentina).
  const laborales: DatoLaboral[] = [
    { key: "numero_legajo", value: sinDato(legajo.numero_legajo ?? "") },
    { key: "area", value: sinDato(legajo.area ?? "") },
    { key: "puesto", value: sinDato(legajo.puesto ?? "") },
    { key: "fecha_ingreso", value: sinDato(formatearFecha(legajo.fecha_ingreso)) },
    {
      key: "antiguedad",
      value: legajo.fecha_ingreso
        ? textoAntiguedad(calcularAntiguedad(legajo.fecha_ingreso, hoyEnArgentina()))
        : t.sinDato,
    },
    { key: "estado_laboral", value: legajo.estado_laboral ? t.estadosLaborales[legajo.estado_laboral] : t.sinDato },
    { key: "sede", value: sinDato(legajo.sede ?? "") },
    { key: "modalidad", value: sinDato(legajo.modalidad ?? "") },
    { key: "convenio", value: sinDato(legajo.convenio ?? "") },
    { key: "bruto_mensual", value: sinDato(formatearPesos(legajo.bruto_mensual)) },
  ];

  return (
    <MiLegajoScreen
      actual={{ ...legajo, hijos: data.hijos }}
      solicitud={data.solicitud}
      laborales={laborales}
      documentos={resumirDocumentos(data.documentos)}
      esAdmin={user.role === "admin"}
      vacio={legajoVacio(legajo, data.hijos)}
    />
  );
}
