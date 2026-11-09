"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ChangeEvent, type DragEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatCopy } from "@/lib/copy/format";
import { copyRecibos } from "@/lib/copy/recibos";
import { pasoSiguiente, responder, type Confirmaciones, type Paso } from "@/lib/recibos/carga-flujo";
import type { FilaCarga, PeriodoVista } from "@/lib/recibos/carga-datos";
import { createClient } from "@/lib/supabase/client";
import {
  cerrarPeriodoRecibos,
  crearPeriodoRecibos,
  descartarSubidaRecibo,
  obtenerUrlReciboAdmin,
  prepararSubidaRecibo,
  publicarPeriodoRecibos,
  reabrirPeriodoRecibos,
  registrarRecibo,
} from "./actions";

const t = copyRecibos;
const PDF = "application/pdf";

type CargaRecibosScreenProps = {
  periodos: PeriodoVista[];
  periodo: PeriodoVista | null;
  filas: FilaCarga[];
  listaFallo: boolean;
};

// MM/AAAA.
export function etiquetaPeriodo(periodo: Pick<PeriodoVista, "anio" | "mes">): string {
  return `${String(periodo.mes).padStart(2, "0")}/${periodo.anio}`;
}

export function CargaRecibosScreen({ periodos, periodo, filas, listaFallo }: CargaRecibosScreenProps) {
  const router = useRouter();
  const [aviso, setAviso] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const conRecibo = filas.filter((fila) => fila.estado !== "sin_recibo").length;
  const abierto = periodo !== null && periodo.estado !== "cerrado";

  return (
    <>
      <PageHeader
        kicker={t.kicker}
        title={t.title}
        actions={
          <Button variant="secondary" onClick={() => setCreando(true)}>
            {t.periodos.nuevo}
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-[34px] pb-10 pt-[26px]">
        <p className="text-ink-soft">{t.intro}</p>
        {aviso ? (
          <p role="status" className="text-[12.5px] italic text-ink-soft" data-testid="aviso-recibos">
            {aviso}
          </p>
        ) : null}

        {listaFallo ? (
          <Panel>
            <p role="alert" className="text-accent-deep">
              {t.errors.listaFallo}
            </p>
          </Panel>
        ) : periodo === null ? (
          <Panel>
            <p className="text-ink-soft" data-testid="sin-periodos">
              {t.periodos.vacio}
            </p>
          </Panel>
        ) : (
          <>
            <PeriodoPanel
              periodos={periodos}
              periodo={periodo}
              onCambio={(mensaje) => {
                setAviso(mensaje);
                router.refresh();
              }}
            />
            {periodo.estado === "borrador" ? (
              <Banner tone="attention">
                <span data-testid="banner-borrador">{t.banners.borrador}</span>
              </Banner>
            ) : null}
            {periodo.estado === "cerrado" ? (
              <Banner>
                <span data-testid="banner-cerrado">{t.banners.cerrado}</span>
              </Banner>
            ) : null}
            <p className="text-[14px] tabular-nums text-ink-soft" data-testid="conteo-recibos">
              {formatCopy(t.conteo, { con: String(conRecibo), sin: String(filas.length - conRecibo) })}
            </p>
            {filas.length === 0 ? (
              <Panel>
                <p className="text-ink-soft">{t.tabla.sinEmpleados}</p>
              </Panel>
            ) : (
              <ul aria-label={t.tabla.label} className="rounded-md border border-line bg-surface">
                {filas.map((fila) => (
                  <FilaRecibo key={fila.empleadoId} fila={fila} periodo={periodo} editable={abierto} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <NuevoPeriodoDialog
        open={creando}
        onClose={() => setCreando(false)}
        onCreado={(id, etiqueta) => {
          setCreando(false);
          setAviso(formatCopy(t.avisos.creado, { periodo: etiqueta }));
          router.push(`/recibos?periodo=${id}`);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Period: selector, state and its one change (with confirmation)
// ---------------------------------------------------------------------------
type Cambio = "publicar" | "cerrar" | "reabrir";

const CAMBIO_DE: Record<PeriodoVista["estado"], Cambio> = { borrador: "publicar", publicado: "cerrar", cerrado: "reabrir" };
const ACCION_DE: Record<Cambio, (input: { periodoId: string }) => ReturnType<typeof publicarPeriodoRecibos>> = {
  publicar: publicarPeriodoRecibos,
  cerrar: cerrarPeriodoRecibos,
  reabrir: reabrirPeriodoRecibos,
};
const AVISO_DE: Record<Cambio, string> = { publicar: t.avisos.publicado, cerrar: t.avisos.cerrado, reabrir: t.avisos.reabierto };

function PeriodoPanel({
  periodos,
  periodo,
  onCambio,
}: {
  periodos: PeriodoVista[];
  periodo: PeriodoVista;
  onCambio: (mensaje: string) => void;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  const cambio = CAMBIO_DE[periodo.estado];
  const etiqueta = etiquetaPeriodo(periodo);
  const confirmacion = t.confirmaciones[cambio];

  function confirmar() {
    setError(null);
    startTransition(async () => {
      const result = await ACCION_DE[cambio]({ periodoId: periodo.id });
      setConfirmando(false);
      if (result.ok) onCambio(formatCopy(AVISO_DE[cambio], { periodo: etiqueta }));
      else setError(result.error);
    });
  }

  return (
    <Panel className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 sm:w-[260px]">
          <Select
            label={t.periodos.label}
            value={periodo.id}
            onChange={(event) => router.push(`/recibos?periodo=${event.target.value}`)}
            options={periodos.map((p) => ({
              value: p.id,
              label: formatCopy(t.periodos.opcion, { periodo: etiquetaPeriodo(p), estado: t.periodos.estados[p.estado] }),
            }))}
          />
        </div>
        <StatusBadge
          label={t.periodos.estados[periodo.estado]}
          tone={periodo.estado === "publicado" ? "active" : "secondary"}
          className="self-start sm:mb-2.5 sm:self-auto"
        />
      </div>
      <div className="flex flex-col gap-2 sm:items-end">
        <Button onClick={() => setConfirmando(true)} disabled={pendiente}>
          {t.acciones[cambio]}
        </Button>
        {error ? (
          <p role="alert" className="text-[12.5px] italic text-accent-deep">
            {error}
          </p>
        ) : null}
      </div>
      <Dialog
        open={confirmando}
        onClose={() => setConfirmando(false)}
        title={formatCopy(confirmacion.title, { periodo: etiqueta })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmando(false)} disabled={pendiente}>
              {t.common.cancelar}
            </Button>
            <Button onClick={confirmar} disabled={pendiente}>
              {pendiente ? t.acciones.procesando : confirmacion.confirmar}
            </Button>
          </>
        }
      >
        <p className="text-ink-soft">{confirmacion.body}</p>
      </Dialog>
    </Panel>
  );
}

function NuevoPeriodoDialog({
  open,
  onClose,
  onCreado,
}: {
  open: boolean;
  onClose: () => void;
  onCreado: (periodoId: string, etiqueta: string) => void;
}) {
  const hoy = new Date();
  const [mes, setMes] = useState(String(hoy.getMonth() + 1));
  const [anio, setAnio] = useState(String(hoy.getFullYear()));
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  function crear() {
    setError(null);
    const valores = { anio: Number(anio), mes: Number(mes) };
    startTransition(async () => {
      const result = await crearPeriodoRecibos(valores);
      if (result.ok && result.data) onCreado(result.data.periodoId, etiquetaPeriodo(valores));
      else setError(result.ok ? t.errors.accionFallo : result.error);
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.nuevoPeriodo.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pendiente}>
            {t.common.cancelar}
          </Button>
          <Button onClick={crear} disabled={pendiente}>
            {pendiente ? t.nuevoPeriodo.creando : t.nuevoPeriodo.crear}
          </Button>
        </>
      }
    >
      <p className="text-ink-soft">{t.nuevoPeriodo.intro}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label={t.nuevoPeriodo.mes}
          value={mes}
          onChange={(event) => setMes(event.target.value)}
          options={t.nuevoPeriodo.meses.map((nombre, i) => ({ value: String(i + 1), label: nombre }))}
        />
        <Field
          label={t.nuevoPeriodo.anio}
          type="number"
          inputMode="numeric"
          min={2000}
          max={2100}
          value={anio}
          onChange={(event) => setAnio(event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// One employee: state, drop zone and the upload flow
// ---------------------------------------------------------------------------
type Fase = "libre" | "subiendo" | "verificando";
type Pregunta = { paso: Exclude<Paso, { tipo: "listo" }>; path: string; confirmaciones: Confirmaciones };

function FilaRecibo({ fila, periodo, editable }: { fila: FilaCarga; periodo: PeriodoVista; editable: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [fase, setFase] = useState<Fase>("libre");
  const [arrastrando, setArrastrando] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; error: boolean } | null>(null);
  const [pregunta, setPregunta] = useState<Pregunta | null>(null);
  const ocupado = fase !== "libre" || pregunta !== null;
  const ids = { periodoId: periodo.id, empleadoId: fila.empleadoId };

  // The answer to the last registration: done, or the next question.
  async function avanzar(path: string, confirmaciones: Confirmaciones) {
    setFase("verificando");
    const result = await registrarRecibo({ ...ids, path, ...confirmaciones });
    setFase("libre");
    if (!result.ok || !result.data) {
      setMensaje({ texto: result.ok ? t.errors.registroFallo : result.error, error: true });
      return;
    }
    const paso = pasoSiguiente(result.data);
    if (paso.tipo === "listo") {
      setMensaje({ texto: t.fila.cargado, error: false });
      router.refresh();
      return;
    }
    setPregunta({ paso, path, confirmaciones });
  }

  async function procesar(file: File) {
    setMensaje(null);
    setFase("subiendo");
    const tipo = file.type || (file.name.toLowerCase().endsWith(".pdf") ? PDF : "");
    const preparada = await prepararSubidaRecibo({ ...ids, tamano: file.size, tipo });
    if (!preparada.ok || !preparada.data) {
      setFase("libre");
      setMensaje({ texto: preparada.ok ? t.errors.subidaFallo : preparada.error, error: true });
      return;
    }
    const { bucket, path, token } = preparada.data;
    const subida = await createClient().storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: tipo });
    if (subida.error) {
      setFase("libre");
      setMensaje({ texto: t.errors.subidaFallo, error: true });
      return;
    }
    await avanzar(path, {});
  }

  async function contestar(acepta: boolean) {
    if (!pregunta) return;
    const { paso, path, confirmaciones } = pregunta;
    setPregunta(null);
    const siguiente = responder(confirmaciones, paso, acepta);
    if (siguiente !== "descartar") {
      await avanzar(path, siguiente);
      return;
    }
    setFase("verificando");
    const descarte = await descartarSubidaRecibo({ ...ids, path });
    setFase("libre");
    setMensaje(descarte.ok ? { texto: t.fila.descartado, error: false } : { texto: descarte.error, error: true });
  }

  function elegido(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void procesar(file);
  }

  function soltado(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setArrastrando(false);
    const file = event.dataTransfer.files?.[0];
    if (file && editable && !ocupado) void procesar(file);
  }

  async function ver() {
    if (!fila.reciboId) return;
    const result = await obtenerUrlReciboAdmin({ reciboId: fila.reciboId });
    if (result.ok && result.data) window.location.assign(result.data.url);
    else setMensaje({ texto: result.ok ? t.errors.verFallo : result.error, error: true });
  }

  return (
    <li
      aria-label={fila.nombre}
      data-testid="fila-recibo"
      className="flex flex-col gap-3 border-b border-line-soft px-[18px] py-[14px] last:border-b-0 md:flex-row md:items-center md:gap-5"
    >
      <div className="flex min-w-0 items-center justify-between gap-3 md:w-[38%]">
        <p className="min-w-0 break-words text-[15px]">{fila.nombre}</p>
        <StatusBadge
          label={t.estadosFila[fila.estado]}
          tone={fila.estado === "sin_recibo" ? "secondary" : "active"}
          className="shrink-0"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div
          onDragOver={(event) => {
            if (!editable || ocupado) return;
            event.preventDefault();
            setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={soltado}
          className={cx(
            "flex flex-wrap items-center gap-2 sm:rounded-md sm:px-3 sm:py-2",
            editable && "sm:border sm:border-dashed sm:border-line",
            arrastrando && "sm:border-accent sm:bg-accent-soft",
          )}
        >
          {editable ? (
            <>
              <span className="hidden flex-1 text-[12.5px] italic text-ink-soft sm:inline">{t.fila.soltar}</span>
              <input
                ref={input}
                type="file"
                accept={PDF}
                className="sr-only"
                tabIndex={-1}
                aria-label={formatCopy(t.fila.zona, { nombre: fila.nombre })}
                onChange={elegido}
                disabled={ocupado}
              />
              <Button onClick={() => input.current?.click()} disabled={ocupado}>
                {fase === "subiendo"
                  ? t.fila.subiendo
                  : fase === "verificando"
                    ? t.fila.verificando
                    : fila.estado === "sin_recibo"
                      ? t.fila.elegir
                      : t.fila.reemplazar}
              </Button>
            </>
          ) : null}
          {fila.reciboId ? (
            <Button variant="secondary" onClick={ver} disabled={ocupado}>
              {t.fila.ver}
            </Button>
          ) : null}
        </div>
        {mensaje ? (
          <p
            role={mensaje.error ? "alert" : "status"}
            className={cx("text-[12.5px] italic", mensaje.error ? "text-accent-deep" : "text-ink-soft")}
          >
            {mensaje.texto}
          </p>
        ) : null}
      </div>
      {pregunta ? (
        <PreguntaDialog
          pregunta={pregunta}
          nombre={fila.nombre}
          periodo={etiquetaPeriodo(periodo)}
          onRespuesta={(acepta) => void contestar(acepta)}
        />
      ) : null}
    </li>
  );
}

// The DNI result first, then the replacement (carga-flujo.ts). No way out
// but the two answers: Escape and the backdrop do nothing.
function PreguntaDialog({
  pregunta,
  nombre,
  periodo,
  onRespuesta,
}: {
  pregunta: Pregunta;
  nombre: string;
  periodo: string;
  onRespuesta: (acepta: boolean) => void;
}) {
  const d = t.dialogos;
  const { paso } = pregunta;
  let titulo: string;
  let cuerpo: string[];
  let si: string;
  let no: string;
  if (paso.tipo === "dialogo_reemplazo") {
    titulo = d.reemplazo.title;
    cuerpo = [formatCopy(d.reemplazo.body, { nombre, periodo })];
    if (paso.firmado) cuerpo.push(formatCopy(d.reemplazo.firmado, { nombre }));
    si = d.reemplazo.confirmar;
    no = t.common.cancelar;
  } else {
    const texto =
      paso.motivo === "dni_no_encontrado" ? d.dniNoEncontrado : paso.motivo === "sin_dni" ? d.sinDni : d.noVerificable;
    titulo = texto.title;
    const motivo = paso.detalle ? d.motivosNoVerificable[paso.detalle] : d.motivosNoVerificable.ilegible;
    cuerpo = [formatCopy(texto.body, { nombre, motivo })];
    si = d.aceptar;
    no = d.rechazar;
  }
  return (
    <Dialog
      open
      dismissible={false}
      onClose={() => onRespuesta(false)}
      title={titulo}
      footer={
        <>
          <Button variant="secondary" onClick={() => onRespuesta(false)}>
            {no}
          </Button>
          <Button onClick={() => onRespuesta(true)}>{si}</Button>
        </>
      }
    >
      {cuerpo.map((parrafo) => (
        <p key={parrafo} className="text-ink-soft" data-testid="pregunta-recibo">
          {parrafo}
        </p>
      ))}
    </Dialog>
  );
}
