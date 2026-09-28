"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Panel } from "@/components/ui/Panel";
import { TextArea } from "@/components/ui/TextArea";
import { MAX_MOTIVO_RECHAZO, validarMotivo } from "@/lib/aprobaciones/motivo";
import type { ResultadoDecision } from "@/lib/aprobaciones/resultado";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { aprobarDocumento, aprobarSolicitud, rechazarDocumento, rechazarSolicitud, type DecisionResult } from "./actions";

const t = copy.aprobaciones.detalle;

type DecisionPanelProps = {
  clase: "solicitud" | "documento";
  id: string;
};

const ACCIONES = {
  solicitud: {
    aprobar: (id: string) => aprobarSolicitud({ solicitudId: id }),
    rechazar: (id: string, motivo: string) => rechazarSolicitud({ solicitudId: id, motivo }),
    aprobado: "solicitudAprobada",
    rechazado: "solicitudRechazada",
    rechazarTitle: t.rechazarTitle,
  },
  documento: {
    aprobar: (id: string) => aprobarDocumento({ documentoId: id }),
    rechazar: (id: string, motivo: string) => rechazarDocumento({ documentoId: id, motivo }),
    aprobado: "documentoAprobado",
    rechazado: "documentoRechazado",
    rechazarTitle: t.rechazarDocumentoTitle,
  },
} as const satisfies Record<
  DecisionPanelProps["clase"],
  {
    aprobar: (id: string) => Promise<DecisionResult>;
    rechazar: (id: string, motivo: string) => Promise<DecisionResult>;
    aprobado: ResultadoDecision;
    rechazado: ResultadoDecision;
    rechazarTitle: string;
  }
>;

// Approve or reject a pending item as a whole. After a decision the inbox
// opens with a confirmation; if the item was already decided elsewhere, the
// message is shown and the page refreshes (the buttons go away).
export function DecisionPanel({ clase, id }: DecisionPanelProps) {
  const router = useRouter();
  const acciones = ACCIONES[clase];
  const [error, setError] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [motivoError, setMotivoError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function aprobar() {
    setError(null);
    startTransition(async () => {
      let result: DecisionResult;
      try {
        result = await acciones.aprobar(id);
      } catch {
        result = { ok: false, error: copy.aprobaciones.errors.guardarFallo };
      }
      if (result.ok) {
        router.push(`/aprobaciones?resultado=${acciones.aprobado}`);
        return;
      }
      setError(result.error);
      if (result.yaDecidido) router.refresh();
    });
  }

  function rechazar() {
    const validado = validarMotivo(motivo);
    if (!validado.ok) {
      setMotivoError(validado.error);
      return;
    }
    setMotivoError(null);
    startTransition(async () => {
      let result: DecisionResult;
      try {
        result = await acciones.rechazar(id, validado.motivo);
      } catch {
        result = { ok: false, error: copy.aprobaciones.errors.guardarFallo };
      }
      if (result.ok) {
        router.push(`/aprobaciones?resultado=${acciones.rechazado}`);
        return;
      }
      if (result.yaDecidido) {
        setRechazando(false);
        setError(result.error);
        router.refresh();
        return;
      }
      setMotivoError(result.error);
    });
  }

  return (
    <Panel data-testid="decision">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            setError(null);
            setMotivoError(null);
            setRechazando(true);
          }}
          disabled={pending}
        >
          {t.rechazar}
        </Button>
        <Button onClick={aprobar} disabled={pending}>
          {pending && !rechazando ? t.aprobando : t.aprobar}
        </Button>
      </div>
      {error ? (
        <p role="alert" data-testid="decision-error" className="mt-3 text-right text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}

      <Dialog open={rechazando} onClose={() => setRechazando(false)} title={acciones.rechazarTitle}>
        <p className="text-ink-soft">{t.rechazarBody}</p>
        <TextArea
          label={copy.aprobaciones.motivoRechazoLabel}
          name="motivo"
          value={motivo}
          maxLength={MAX_MOTIVO_RECHAZO}
          hint={formatCopy(t.motivoHint, { max: String(MAX_MOTIVO_RECHAZO) })}
          error={motivoError ?? undefined}
          onChange={(event) => {
            setMotivo(event.target.value);
            setMotivoError(null);
          }}
        />
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setRechazando(false)}>
            {t.cancelar}
          </Button>
          <Button onClick={rechazar} disabled={pending}>
            {pending ? t.rechazando : t.confirmarRechazo}
          </Button>
        </div>
      </Dialog>
    </Panel>
  );
}
