"use client";

import { useState, useTransition } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LabelValueGrid } from "@/components/ui/LabelValueGrid";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import type { LegajoActual } from "@/lib/aprobaciones/solicitudes";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import type { ResumenDocumento } from "@/lib/documentos/resumen";
import { GRUPOS_EDITABLES } from "@/lib/legajo/grupos";
import type { SolicitudActual } from "@/lib/legajo/mi-legajo";
import { cancelarSolicitud } from "./actions";
import { DocumentosSection } from "./DocumentosSection";
import { GrupoPanel } from "./GrupoPanel";

const t = copy.miLegajo;

export type DatoLaboral = { key: keyof typeof t.camposLaborales; value: string };

type MiLegajoScreenProps = {
  actual: LegajoActual;
  solicitud: SolicitudActual | null;
  laborales: DatoLaboral[];
  documentos: ResumenDocumento[];
  esAdmin: boolean;
  vacio: boolean;
};

export function MiLegajoScreen({ actual, solicitud, laborales, documentos, esAdmin, vacio }: MiLegajoScreenProps) {
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmarCancelacion, setConfirmarCancelacion] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelando, startCancel] = useTransition();

  const pendiente = solicitud?.estado === "pendiente" ? solicitud : null;
  const rechazada = solicitud?.estado === "rechazada" ? solicitud : null;
  // Proposed values of the pending request, by field.
  const propuestos = new Map((pendiente?.items ?? []).map((item) => [item.campo, item.valorPropuesto]));

  function cancelar() {
    startCancel(async () => {
      const result = await cancelarSolicitud({ solicitudId: pendiente?.id });
      if (!result.ok) {
        setCancelError(result.error);
        return;
      }
      setConfirmarCancelacion(false);
      setAviso(t.exito.cancelada);
    });
  }

  return (
    <>
      <PageHeader kicker={t.kicker} title={t.title} />
      <div className="flex flex-col gap-5 px-[34px] pb-10 pt-[26px]">
        {esAdmin ? <Banner>{t.admin.nota}</Banner> : null}

        {pendiente ? (
          <Banner
            tone="attention"
            actions={
              <Button variant="secondary" onClick={() => setConfirmarCancelacion(true)}>
                {t.pendiente.cancelar}
              </Button>
            }
          >
            <span data-testid="banner-pendiente">{t.pendiente.banner}</span>
          </Banner>
        ) : null}

        {rechazada ? (
          <Banner tone="attention">
            <span data-testid="banner-rechazada">
              {formatCopy(t.rechazada.banner, { motivo: rechazada.motivoRechazo ?? "" })}
            </span>
          </Banner>
        ) : null}

        {vacio ? (
          <Panel>
            <h2 className="text-[24px] font-normal leading-[1.1]">{t.vacio.title}</h2>
            <p className="mt-2 text-ink-soft">{t.vacio.body}</p>
          </Panel>
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
            bloqueado={pendiente !== null}
            esAdmin={esAdmin}
            onGuardado={setAviso}
          />
        ))}

        <Panel data-testid="grupo-E">
          <h2 className="text-[24px] font-normal leading-[1.1]">{t.grupos.E}</h2>
          <p className="mt-1 text-[12.5px] italic text-ink-soft">{t.laboralesNota}</p>
          <LabelValueGrid
            className="mt-4"
            items={laborales.map((dato) => ({ key: dato.key, label: t.camposLaborales[dato.key], value: dato.value }))}
          />
        </Panel>

        <DocumentosSection documentos={documentos} esAdmin={esAdmin} onAviso={setAviso} />
      </div>

      <Dialog
        open={confirmarCancelacion}
        onClose={() => setConfirmarCancelacion(false)}
        title={t.pendiente.confirmTitle}
      >
        <p className="text-ink-soft">{t.pendiente.confirmBody}</p>
        {cancelError ? (
          <p role="alert" className="text-[12.5px] italic text-accent-deep">
            {cancelError}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmarCancelacion(false)}>
            {t.pendiente.volver}
          </Button>
          <Button onClick={cancelar} disabled={cancelando}>
            {t.pendiente.confirmar}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
