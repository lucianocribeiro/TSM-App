import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { buttonClassName } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { listarCuentas } from "@/lib/admin/cuentas";
import { requireRole } from "@/lib/auth/require-role";
import { copy } from "@/lib/copy/es-AR";
import { historialDocumentos, reemplazantes } from "@/lib/documentos/historial";
import { resumirDocumentos } from "@/lib/documentos/resumen";
import { cargarLegajoAdmin } from "@/lib/legajo/admin-legajos";
import { formLaboralInicial } from "@/lib/legajo/laborales";
import { nombreCompleto } from "@/lib/cuentas/listado";
import { datosLaboralesVista } from "@/lib/legajo/vista";
import { LegajoAdminScreen } from "./LegajoAdminScreen";

const t = copy.legajos;

type LegajoPageProps = { params: Promise<{ id: string }> };

// One employee's legajo for the Admin (PRD US-4): every group, the children
// and the documents, all editable directly. The id is the profile id.
export default async function LegajoPage({ params }: LegajoPageProps) {
  const user = await requireRole("admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await cargarLegajoAdmin(id);
  if (data === "no-encontrado") notFound();
  if (!data) {
    return (
      <>
        <PageHeader
          kicker={t.detalle.kicker}
          title={t.title}
          actions={
            <Link href="/legajos" className={buttonClassName("secondary")}>
              {t.detalle.volver}
            </Link>
          }
        />
        <div className="px-[34px] pb-10 pt-[26px]">
          <Panel>
            <p role="alert" className="text-accent-deep">
              {t.detalle.cargaFallo}
            </p>
          </Panel>
        </div>
      </>
    );
  }

  const { legajo } = data;
  // Who replaced each version: the name from their legajo, else their email
  // (as in Usuarios). Accounts are listed only when there is history.
  const nombres = new Map<string, string>();
  if (reemplazantes(data.documentos).length > 0) {
    const cuentas = await listarCuentas();
    for (const cuenta of cuentas.ok ? (cuentas.data ?? []) : []) nombres.set(cuenta.id, cuenta.nombre ?? cuenta.email);
  }

  return (
    <LegajoAdminScreen
      profileId={id}
      nombre={nombreCompleto(legajo.nombres, legajo.apellido)}
      propio={id === user.id}
      estadoCuenta={data.estadoCuenta}
      actual={{ ...legajo, hijos: data.hijos }}
      solicitud={data.solicitud}
      laborales={datosLaboralesVista(legajo)}
      formLaboral={formLaboralInicial(legajo)}
      documentos={resumirDocumentos(data.documentos)}
      historial={historialDocumentos(data.documentos, nombres)}
    />
  );
}
