"use client";

import Link from "next/link";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { buttonClassName } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import type { LegajoActual } from "@/lib/aprobaciones/solicitudes";
import { copy } from "@/lib/copy/es-AR";
import type { ResumenDocumento } from "@/lib/documentos/resumen";
import { grupoBloqueado } from "@/lib/legajo/bloqueo";
import { GRUPOS_EDITABLES, type GrupoEditable } from "@/lib/legajo/grupos";
import type { FormLaboral } from "@/lib/legajo/laborales";
import type { SolicitudActual } from "@/lib/legajo/mi-legajo";
import type { DatoLaboral } from "@/lib/legajo/vista";
import type { Database } from "@/lib/supabase/database.types";
import { DocumentosSection, type AccionesDocumentos } from "../../mi-legajo/DocumentosSection";
import { GrupoPanel } from "../../mi-legajo/GrupoPanel";
import {
  actualizarGrupoLegajo,
  descartarSubidaAdmin,
  eliminarDocumentoAdmin,
  obtenerUrlDocumentoAdmin,
  prepararSubidaAdmin,
  registrarDocumentoAdmin,
} from "../actions";
import { GrupoLaboralPanel } from "./GrupoLaboralPanel";

const t = copy.legajos;

type LegajoAdminScreenProps = {
  profileId: string;
  nombre: string | null;
  // The Admin's own legajo.
  propio: boolean;
  estadoCuenta: Database["public"]["Enums"]["cuenta_estado"];
  actual: LegajoActual;
  solicitud: SolicitudActual | null;
  laborales: DatoLaboral[];
  formLaboral: FormLaboral;
  documentos: ResumenDocumento[];
};

export function LegajoAdminScreen({
  profileId,
  nombre,
  propio,
  estadoCuenta,
  actual,
  solicitud,
  laborales,
  formLaboral,
  documentos,
}: LegajoAdminScreenProps) {
  const [aviso, setAviso] = useState<string | null>(null);

  const pendiente = solicitud?.estado === "pendiente" ? solicitud : null;
  // Proposed values of the pending request, by field, shown under each value.
  const propuestos = new Map((pendiente?.items ?? []).map((item) => [item.campo, item.valorPropuesto]));

  // The actions, bound to this employee.
  const guardarGrupo = (input: { grupo: GrupoEditable; valores: Record<string, unknown> }) =>
    actualizarGrupoLegajo({ ...input, profileId });
  const accionesDocumentos: AccionesDocumentos = {
    preparar: (input) => prepararSubidaAdmin({ ...input, profileId }),
    registrar: (input) => registrarDocumentoAdmin({ ...input, profileId }),
    descartar: (input) => descartarSubidaAdmin({ ...input, profileId }),
    descargar: (input) => obtenerUrlDocumentoAdmin({ ...input, profileId }),
    eliminar: (input) => eliminarDocumentoAdmin({ ...input, profileId }),
  };

  return (
    <>
      <PageHeader
        kicker={t.detalle.kicker}
        title={nombre ?? t.sinNombre}
        actions={
          <>
            <Link href="/legajos" className={buttonClassName("secondary")}>
              {t.detalle.volver}
            </Link>
            <Link href={`/usuarios/${profileId}`} prefetch={false} className={buttonClassName("secondary")}>
              {t.detalle.verCuenta}
            </Link>
          </>
        }
      />
      <div className="flex flex-col gap-5 px-[34px] pb-10 pt-[26px]">
        <Banner>{propio ? t.detalle.propio : t.detalle.nota}</Banner>

        {estadoCuenta !== "activa" ? (
          <Banner>
            <span data-testid="banner-baja">{t.detalle.cuentaInactiva}</span>
          </Banner>
        ) : null}

        {pendiente ? (
          <Banner tone="attention">
            <span data-testid="banner-pendiente">{t.detalle.solicitudPendiente}</span>
          </Banner>
        ) : null}

        {aviso ? (
          <p role="status" className="text-[12.5px] italic text-ink-soft">
            {aviso}
          </p>
        ) : null}

        {GRUPOS_EDITABLES.map((grupo) => (
          <GrupoPanel
            key={grupo}
            grupo={grupo}
            actual={actual}
            propuestos={propuestos}
            bloqueado={grupoBloqueado(grupo, pendiente !== null)}
            esAdmin
            guardar={guardarGrupo}
            onGuardado={setAviso}
          />
        ))}

        <GrupoLaboralPanel profileId={profileId} laborales={laborales} inicial={formLaboral} onGuardado={setAviso} />

        <DocumentosSection
          documentos={documentos}
          acciones={accionesDocumentos}
          esAdmin
          eliminable="vigente"
          intro={t.documentos.intro}
          onAviso={setAviso}
        />
      </div>
    </>
  );
}
