"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/Dialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SignaturePad, type SignaturePadHandle } from "@/components/ui/SignaturePad";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatCopy } from "@/lib/copy/format";
import { copyMisRecibos } from "@/lib/copy/mis-recibos";
import { fechaYHora } from "@/lib/format/fecha";
import type { ReciboEmpleado } from "@/lib/recibos/mis-recibos-datos";
import { createClient } from "@/lib/supabase/client";
import { descartarSubidaFirma, firmarRecibo, obtenerUrlMiFirma, obtenerUrlRecibo, prepararSubidaFirma, registrarFirma } from "./actions";

const t = copyMisRecibos;
const PNG = "image/png";

type FirmaVista = { url: string; version: number };
type MisRecibosScreenProps = { recibos: ReciboEmpleado[]; firmaInicial: FirmaVista | null; tieneFirma: boolean; listaFallo: boolean };

const etiqueta = (r: Pick<ReciboEmpleado, "anio" | "mes">) => `${String(r.mes).padStart(2, "0")}/${r.anio}`;

type Aviso = { texto: string; error: boolean };

export function MisRecibosScreen({ recibos, firmaInicial, tieneFirma, listaFallo }: MisRecibosScreenProps) {
  const router = useRouter();
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [firma, setFirma] = useState<FirmaVista | null>(firmaInicial);
  const [conFirma, setConFirma] = useState(tieneFirma);
  const [dibujando, setDibujando] = useState<{ despues: (() => void) | null } | null>(null);
  const [firmando, setFirmando] = useState<ReciboEmpleado | null>(null);

  const cargarFirma = useCallback(async () => {
    const result = await obtenerUrlMiFirma({});
    if (result.ok) {
      setFirma(result.data ?? null);
      setConFirma(Boolean(result.data));
    }
  }, []);

  // Firmar: the drawing dialog first when there is no signature yet.
  function pedirFirma(recibo: ReciboEmpleado) {
    setAviso(null);
    if (conFirma) setFirmando(recibo);
    else setDibujando({ despues: () => setFirmando(recibo) });
  }

  return (
    <>
      <PageHeader kicker={t.kicker} title={t.title} />
      <div className="flex flex-col gap-4 px-[34px] pb-10 pt-[26px]">
        <p className="text-ink-soft">{t.intro}</p>
        {aviso ? (
          <p
            role={aviso.error ? "alert" : "status"}
            data-testid="aviso-mis-recibos"
            className={cx("text-[12.5px] italic", aviso.error ? "text-accent-deep" : "text-ink-soft")}
          >
            {aviso.texto}
          </p>
        ) : null}

        <MiFirmaPanel firma={firma} conFirma={conFirma} onCambiar={() => setDibujando({ despues: null })} />

        {listaFallo ? (
          <Panel>
            <p role="alert" className="text-accent-deep">
              {t.errors.listaFallo}
            </p>
          </Panel>
        ) : recibos.length === 0 ? (
          <Panel data-testid="mis-recibos-vacio">
            <h2 className="text-[22px] font-normal">{t.vacio.title}</h2>
            <p className="mt-1 text-ink-soft">{t.vacio.body}</p>
          </Panel>
        ) : (
          <ul aria-label={t.lista.label} className="rounded-md border border-line bg-surface">
            {recibos.map((recibo) => (
              <FilaRecibo key={recibo.id} recibo={recibo} onFirmar={() => pedirFirma(recibo)} onAviso={setAviso} />
            ))}
          </ul>
        )}
      </div>

      {dibujando ? (
        <DibujoDialog
          onCancelar={() => setDibujando(null)}
          onGuardada={async () => {
            const despues = dibujando.despues;
            setDibujando(null);
            await cargarFirma();
            setConFirma(true);
            if (despues) despues();
            else setAviso({ texto: t.miFirma.guardada, error: false });
          }}
        />
      ) : null}

      {firmando ? (
        <ConfirmarDialog
          recibo={firmando}
          firma={firma}
          onCerrar={() => setFirmando(null)}
          onSinFirma={() => {
            const recibo = firmando;
            setFirmando(null);
            setConFirma(false);
            setDibujando({ despues: () => setFirmando(recibo) });
          }}
          onFirmado={() => {
            setAviso({ texto: formatCopy(t.firmar.exito, { periodo: etiqueta(firmando) }), error: false });
            setFirmando(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// One receipt
// ---------------------------------------------------------------------------
function FilaRecibo({ recibo, onFirmar, onAviso }: { recibo: ReciboEmpleado; onFirmar: () => void; onAviso: (aviso: Aviso) => void }) {
  const [abriendo, setAbriendo] = useState(false);
  const firmado = recibo.estado === "firmado";
  const cuando = recibo.firmadoAt ? fechaYHora(recibo.firmadoAt) : null;

  // Ver: a new tab, opened at the click (so the browser allows it) and sent to
  // the signed URL once it arrives (decision 9).
  async function ver() {
    const pestana = window.open("about:blank", "_blank");
    setAbriendo(true);
    const result = await obtenerUrlRecibo({ reciboId: recibo.id, modo: "ver" });
    setAbriendo(false);
    if (result.ok && result.data) {
      if (pestana) pestana.location.href = result.data.url;
      else window.location.assign(result.data.url);
    } else {
      pestana?.close();
      onAviso({ texto: result.ok ? t.errors.verFallo : result.error, error: true });
    }
  }

  async function descargar() {
    setAbriendo(true);
    const result = await obtenerUrlRecibo({ reciboId: recibo.id, modo: "descargar" });
    setAbriendo(false);
    if (result.ok && result.data) window.location.assign(result.data.url);
    else onAviso({ texto: result.ok ? t.errors.verFallo : result.error, error: true });
  }

  return (
    <li
      aria-label={formatCopy(t.lista.periodo, { periodo: etiqueta(recibo) })}
      data-testid="mi-recibo"
      className="flex flex-col gap-3 border-b border-line-soft px-[18px] py-[14px] last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[15px] tabular-nums">{formatCopy(t.lista.periodo, { periodo: etiqueta(recibo) })}</p>
          <StatusBadge label={firmado ? t.estados.firmado : t.estados.pendiente} tone={firmado ? "secondary" : "active"} />
        </div>
        {cuando ? <p className="text-[12.5px] italic text-ink-soft">{formatCopy(t.lista.firmadoEl, cuando)}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={ver} disabled={abriendo}>
          {t.acciones.ver}
        </Button>
        {firmado ? (
          <Button variant="secondary" onClick={descargar} disabled={abriendo}>
            {t.acciones.descargar}
          </Button>
        ) : (
          <Button onClick={onFirmar} disabled={abriendo}>
            {t.acciones.firmar}
          </Button>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Mi firma
// ---------------------------------------------------------------------------
function MiFirmaPanel({
  firma,
  conFirma,
  onCambiar,
}: {
  firma: { url: string; version: number } | null;
  conFirma: boolean;
  onCambiar: () => void;
}) {
  return (
    <Panel className="flex flex-col gap-3" aria-labelledby="mi-firma-titulo">
      <h2 id="mi-firma-titulo" className="label-accent">
        {t.miFirma.title}
      </h2>
      <p className="text-ink-soft">{conFirma ? t.miFirma.intro : t.miFirma.sinFirma}</p>
      {firma ? <VistaFirma url={firma.url} /> : null}
      {conFirma ? <p className="text-[12.5px] italic text-ink-soft">{t.miFirma.nota}</p> : null}
      <div>
        <Button variant="secondary" onClick={onCambiar}>
          {conFirma ? t.miFirma.cambiar : t.miFirma.registrar}
        </Button>
      </div>
    </Panel>
  );
}

function VistaFirma({ url }: { url: string }) {
  return (
    <div className="w-full max-w-[320px] rounded-md border border-line bg-[var(--firma-fondo)] p-2">
      <Image src={url} alt={t.miFirma.previewAlt} width={600} height={180} unoptimized className="h-auto w-full" data-testid="mi-firma-imagen" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawing and confirmation dialogs
// ---------------------------------------------------------------------------
function DibujoDialog({ onCancelar, onGuardada }: { onCancelar: () => void; onGuardada: () => Promise<void> }) {
  const pad = useRef<SignaturePadHandle>(null);
  const [suficiente, setSuficiente] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  function guardar() {
    setError(null);
    startTransition(async () => {
      const blob = await pad.current?.toBlob();
      if (!blob) {
        setError(t.errors.firmaFallo);
        return;
      }
      const preparada = await prepararSubidaFirma({ tamano: blob.size, tipo: PNG });
      if (!preparada.ok || !preparada.data) {
        setError(preparada.ok ? t.errors.firmaFallo : preparada.error);
        return;
      }
      const { bucket, path, token } = preparada.data;
      const subida = await createClient().storage.from(bucket).uploadToSignedUrl(path, token, blob, { contentType: PNG });
      if (subida.error) {
        await descartarSubidaFirma({ path });
        setError(t.errors.firmaFallo);
        return;
      }
      const registrada = await registrarFirma({ path });
      if (!registrada.ok) {
        setError(registrada.error);
        return;
      }
      await onGuardada();
    });
  }

  return (
    <Dialog
      open
      onClose={onCancelar}
      title={t.dibujo.title}
      className="max-w-[680px]"
      footer={
        <>
          <Button variant="secondary" onClick={() => pad.current?.clear()} disabled={pendiente}>
            {t.dibujo.borrar}
          </Button>
          <Button variant="secondary" onClick={onCancelar} disabled={pendiente}>
            {t.common.cancelar}
          </Button>
          <Button onClick={guardar} disabled={!suficiente || pendiente}>
            {pendiente ? t.dibujo.guardando : t.dibujo.guardar}
          </Button>
        </>
      }
    >
      <p className="text-ink-soft">{t.dibujo.intro}</p>
      <SignaturePad ref={pad} label={t.dibujo.canvasLabel} onChange={setSuficiente} />
      {!suficiente ? <p className="text-[12.5px] italic text-ink-soft">{t.dibujo.minimo}</p> : null}
      {error ? (
        <p role="alert" className="text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

function ConfirmarDialog({
  recibo,
  firma,
  onCerrar,
  onSinFirma,
  onFirmado,
}: {
  recibo: ReciboEmpleado;
  firma: { url: string; version: number } | null;
  onCerrar: () => void;
  onSinFirma: () => void;
  onFirmado: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  function confirmar() {
    setError(null);
    startTransition(async () => {
      const result = await firmarRecibo({ reciboId: recibo.id });
      if (!result.ok) setError(result.error);
      else if (result.data?.estado === "sin_firma") onSinFirma();
      else onFirmado();
    });
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pendiente) onCerrar();
      }}
      title={formatCopy(t.firmar.title, { periodo: etiqueta(recibo) })}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={pendiente}>
            {t.common.cancelar}
          </Button>
          <Button onClick={confirmar} disabled={pendiente}>
            {pendiente ? t.acciones.firmando : t.firmar.confirmar}
          </Button>
        </>
      }
    >
      <p data-testid="declaracion-firma">{t.firmar.declaracion}</p>
      {firma ? (
        <div className="flex flex-col gap-1.5">
          <p className="label-accent">{t.firmar.tuFirma}</p>
          <VistaFirma url={firma.url} />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
