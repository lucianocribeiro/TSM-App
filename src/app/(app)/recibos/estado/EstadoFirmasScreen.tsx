"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LabelValueGrid } from "@/components/ui/LabelValueGrid";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatCopy } from "@/lib/copy/format";
import { copyRecibos, type FiltroEstadoFirma } from "@/lib/copy/recibos";
import type { PeriodoVista } from "@/lib/recibos/carga-datos";
import type { DetalleRecibo, EstadoPeriodo, FilaEstado } from "@/lib/recibos/estado";
import { etiquetaPeriodo } from "@/lib/recibos/etiqueta";
import { VistasRecibos } from "../VistasRecibos";
import { obtenerUrlArchivoReciboAdmin, obtenerUrlFirmaAdmin } from "./actions";

const t = copyRecibos;
const te = copyRecibos.estado;
const FILTROS: readonly FiltroEstadoFirma[] = ["todos", "firmado", "pendiente", "sin_recibo"];
const RUTA = "/recibos/estado";

type EstadoFirmasScreenProps = {
  periodos: PeriodoVista[];
  periodo: PeriodoVista | null;
  estado: EstadoPeriodo | null;
  listaFallo: boolean;
  detalle: DetalleRecibo | null;
  detalleFallo: boolean;
};

export function EstadoFirmasScreen({ periodos, periodo, estado, listaFallo, detalle, detalleFallo }: EstadoFirmasScreenProps) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<FiltroEstadoFirma>("todos");
  // The receipt whose detail the Admin closed, until the URL drops it.
  const [cerrado, setCerrado] = useState<string | null>(null);
  const filas = useMemo(() => estado?.filas ?? [], [estado]);
  const visibles = useMemo(() => (filtro === "todos" ? filas : filas.filter((fila) => fila.estado === filtro)), [filas, filtro]);
  const base = periodo ? `${RUTA}?periodo=${periodo.id}` : RUTA;

  function cerrarDetalle() {
    if (detalle) setCerrado(detalle.reciboId);
    router.replace(base, { scroll: false });
  }

  return (
    <>
      <PageHeader kicker={t.kicker} title={te.title} />
      <div className="flex flex-col gap-4 px-[34px] pb-10 pt-[26px]">
        <VistasRecibos actual="estado" periodoId={periodo?.id ?? null} />
        <p className="text-ink-soft">{te.intro}</p>
        {detalleFallo ? (
          <p role="alert" className="text-[12.5px] italic text-accent-deep" data-testid="detalle-fallo">
            {te.errors.detalleFallo}
          </p>
        ) : null}

        {listaFallo ? (
          <Panel>
            <p role="alert" className="text-accent-deep">
              {te.errors.listaFallo}
            </p>
          </Panel>
        ) : periodo === null || estado === null ? (
          <Panel>
            <p className="text-ink-soft" data-testid="sin-periodos">
              {t.periodos.vacio}
            </p>
          </Panel>
        ) : (
          <>
            <Panel className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 sm:w-[260px]">
                <Select
                  label={t.periodos.label}
                  value={periodo.id}
                  onChange={(event) => router.push(`${RUTA}?periodo=${event.target.value}`)}
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
            </Panel>
            {periodo.estado === "borrador" ? (
              <Banner tone="attention">
                <span data-testid="banner-borrador-estado">{te.banners.borrador}</span>
              </Banner>
            ) : null}
            <p className="text-[14px] tabular-nums text-ink-soft" data-testid="conteo-estado">
              {formatCopy(te.conteo, {
                firmados: String(estado.conteos.firmado),
                pendientes: String(estado.conteos.pendiente),
                sinRecibo: String(estado.conteos.sin_recibo),
              })}
            </p>
            <SegmentedFilter
              label={te.filtros.label}
              options={FILTROS.map((value) => ({ value, label: te.filtros.opciones[value] }))}
              value={filtro}
              onChange={setFiltro}
              className="max-w-full flex-wrap self-start"
            />
            {filas.length === 0 ? (
              <Panel>
                <p className="text-ink-soft">{te.tabla.sinEmpleados}</p>
              </Panel>
            ) : visibles.length === 0 ? (
              <Panel>
                <p className="text-ink-soft" data-testid="estado-sin-resultados">
                  {te.tabla.sinResultados}
                </p>
              </Panel>
            ) : (
              <ul aria-label={te.tabla.label} className="rounded-md border border-line bg-surface">
                {visibles.map((fila) => (
                  <FilaFirma key={fila.empleadoId} fila={fila} href={fila.reciboId ? `${base}&recibo=${fila.reciboId}` : null} onAbrir={() => setCerrado(null)} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {detalle ? <DetalleDialog detalle={detalle} open={cerrado !== detalle.reciboId} onClose={cerrarDetalle} /> : null}
    </>
  );
}

function FilaFirma({ fila, href, onAbrir }: { fila: FilaEstado; href: string | null; onAbrir: () => void }) {
  return (
    <li
      aria-label={fila.nombre}
      data-testid="fila-estado"
      data-estado={fila.estado}
      className="flex flex-col gap-3 border-b border-line-soft px-[18px] py-[14px] last:border-b-0 md:flex-row md:items-center md:gap-5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 md:w-[38%]">
        <p className="min-w-0 break-words text-[15px]">{fila.nombre}</p>
        {fila.inactiva ? <StatusBadge label={te.inactiva} tone="secondary" className="shrink-0" /> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
        <StatusBadge label={te.estados[fila.estado]} tone={fila.estado === "firmado" ? "active" : "secondary"} className="shrink-0" />
        {fila.firmadoAt ? (
          <span className="text-[14px] tabular-nums text-ink-soft" data-testid="firmado-at">
            {formatCopy(te.firmadoEl, { fecha: fila.firmadoAt })}
          </span>
        ) : null}
      </div>
      {href ? (
        <Link
          href={href}
          scroll={false}
          onClick={onAbrir}
          aria-label={formatCopy(te.detalleDe, { nombre: fila.nombre })}
          className={buttonClassName("secondary", "self-start md:self-auto")}
        >
          {te.detalle}
        </Link>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Detalle of a receipt (decision 8)
// ---------------------------------------------------------------------------
type Archivo = { origen: "actual" | "historial"; id: string };

function DetalleDialog({ detalle, open, onClose }: { detalle: DetalleRecibo; open: boolean; onClose: () => void }) {
  const d = te.dialogo;
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Ver: a new tab opened at the click (so the browser allows it), sent to
  // the signed URL once it arrives. Descargar: the same page, as an attachment.
  async function abrir(archivo: Archivo, modo: "ver" | "descargar") {
    setError(null);
    const pestana = modo === "ver" ? window.open("about:blank", "_blank") : null;
    setOcupado(true);
    const result = await obtenerUrlArchivoReciboAdmin({ ...archivo, modo });
    setOcupado(false);
    if (result.ok && result.data) {
      if (pestana) pestana.location.href = result.data.url;
      else window.location.assign(result.data.url);
    } else {
      pestana?.close();
      setError(result.ok ? te.errors.verFallo : result.error);
    }
  }

  const botones = (archivo: Archivo, nombre: string) => (
    <div className="flex flex-wrap gap-2" data-testid={`archivo-${nombre}`}>
      <Button variant="secondary" onClick={() => void abrir(archivo, "ver")} disabled={ocupado}>
        {d.ver}
      </Button>
      <Button variant="secondary" onClick={() => void abrir(archivo, "descargar")} disabled={ocupado}>
        {d.descargar}
      </Button>
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={formatCopy(d.title, { nombre: detalle.nombre, periodo: etiquetaPeriodo(detalle.periodo) })}
      className="max-h-[calc(100dvh-32px)] max-w-[640px] overflow-y-auto"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {d.cerrar}
        </Button>
      }
    >
      {error ? (
        <p role="alert" className="text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}

      <Seccion titulo={d.actual.title} testid="detalle-actual">
        <LabelValueGrid
          items={[
            { key: "estado", label: d.actual.estado, value: te.estados[detalle.actual.estado] },
            { key: "cargado", label: d.actual.cargado, value: detalle.actual.cargadoAt ?? t.usuarioNoDisponible },
            { key: "cargado-por", label: d.actual.cargadoPor, value: detalle.actual.cargadoPor },
          ]}
        />
        {botones({ origen: "actual", id: detalle.reciboId }, "actual")}
      </Seccion>

      <Seccion titulo={d.firma.title} testid="detalle-firma">
        {detalle.firma ? (
          <>
            <LabelValueGrid
              items={[
                { key: "firmado", label: d.firma.firmadoAt, value: detalle.firma.firmadoAt ?? "" },
                {
                  key: "version",
                  label: d.firma.version,
                  value: detalle.firma.version === null ? "" : formatCopy(d.firma.versionValor, { version: String(detalle.firma.version) }),
                },
              ]}
            />
            {detalle.firma.firmaId ? <ImagenFirma firmaId={detalle.firma.firmaId} /> : null}
          </>
        ) : (
          <p className="text-ink-soft">{d.firma.sinFirma}</p>
        )}
      </Seccion>

      <Seccion titulo={d.dni.title} testid="detalle-dni">
        {detalle.overrides.length === 0 ? (
          <p className="text-ink-soft">{d.dni.vacio}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {detalle.overrides.map((o) => (
              <li key={o.clave} className="rounded-md border border-line-soft p-3" data-testid="override">
                <LabelValueGrid
                  items={[
                    { key: "motivo", label: d.dni.motivo, value: d.dni.motivos[o.motivo] },
                    { key: "quien", label: d.dni.quien, value: o.quien },
                    { key: "cuando", label: d.dni.cuando, value: o.cuando ?? "" },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      <Seccion titulo={d.reemplazos.title} testid="detalle-reemplazos">
        {detalle.reemplazos.length === 0 ? (
          <p className="text-ink-soft">{d.reemplazos.vacio}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {detalle.reemplazos.map((r) => (
              <li
                key={r.historialId}
                aria-label={formatCopy(d.reemplazos.item, { n: String(r.numero) })}
                className="flex flex-col gap-3 rounded-md border border-line-soft p-3"
                data-testid="reemplazo"
              >
                <p className="label-accent">{formatCopy(d.reemplazos.item, { n: String(r.numero) })}</p>
                <LabelValueGrid
                  items={[
                    { key: "quien", label: d.reemplazos.quien, value: r.quien },
                    { key: "cuando", label: d.reemplazos.cuando, value: r.cuando ?? "" },
                    { key: "estado", label: d.reemplazos.estadoAlReemplazo, value: d.reemplazos.estados[r.estadoAlReemplazo] },
                    ...(r.firmadoAt ? [{ key: "firmado", label: d.reemplazos.firmadoAt, value: r.firmadoAt }] : []),
                    { key: "cargado", label: d.reemplazos.cargado, value: r.cargadoAt ?? "" },
                  ]}
                />
                {botones({ origen: "historial", id: r.historialId }, `reemplazo-${r.numero}`)}
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </Dialog>
  );
}

function Seccion({ titulo, testid, children }: { titulo: string; testid: string; children: ReactNode }) {
  return (
    <section aria-label={titulo} data-testid={testid} className="flex flex-col gap-3 border-t border-line-soft pt-4">
      <h3 className="text-[20px] font-normal leading-[1.15]">{titulo}</h3>
      {children}
    </section>
  );
}

// The registered signature used, on the paper backdrop: the image is
// transparent (only the strokes are opaque), so it shows in both themes.
function ImagenFirma({ firmaId }: { firmaId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    let vigente = true;
    void obtenerUrlFirmaAdmin({ firmaId }).then((result) => {
      if (!vigente) return;
      if (result.ok && result.data) setUrl(result.data.url);
      else setFallo(true);
    });
    return () => {
      vigente = false;
    };
  }, [firmaId]);

  if (fallo) {
    return (
      <p role="alert" className="text-[12.5px] italic text-accent-deep">
        {te.dialogo.firma.imagenFallo}
      </p>
    );
  }
  return (
    <div className="w-full max-w-[320px] rounded-md border border-line bg-[var(--firma-fondo)] p-2">
      {url ? (
        <Image src={url} alt={te.dialogo.firma.imagen} width={600} height={180} unoptimized className="h-auto w-full" data-testid="detalle-firma-imagen" />
      ) : (
        <div aria-hidden="true" className="aspect-[10/3] w-full" />
      )}
    </div>
  );
}
