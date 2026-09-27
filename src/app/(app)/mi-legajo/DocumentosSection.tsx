"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { rowClassName, Table, Td, Th } from "@/components/ui/Table";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import type { DocumentoFila, ResumenDocumento } from "@/lib/documentos/resumen";
import { subirDocumento } from "@/lib/documentos/subida";
import { DOCUMENTOS_BUCKET, type DocumentoTipo } from "@/lib/documentos/tipos";
import { validateDocumentoUpload } from "@/lib/documentos/validation";
import { formatearFechaHora } from "@/lib/format/fecha";
import { createClient } from "@/lib/supabase/client";
import {
  descartarSubida,
  eliminarDocumentoPendiente,
  obtenerUrlDocumento,
  prepararSubidaDocumento,
  registrarDocumento,
} from "./actions";

const t = copy.miLegajo.documentos;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

type DocumentosSectionProps = {
  documentos: ResumenDocumento[];
  esAdmin: boolean;
  onAviso: (mensaje: string) => void;
};

export function DocumentosSection({ documentos, esAdmin, onAviso }: DocumentosSectionProps) {
  const [aEliminar, setAEliminar] = useState<DocumentoFila | null>(null);

  return (
    <section aria-labelledby="documentos-title" className="flex flex-col gap-3" data-testid="documentos">
      <div>
        <h2 id="documentos-title" className="text-[24px] font-normal leading-[1.1]">
          {t.title}
        </h2>
        <p className="mt-1 text-[12.5px] italic text-ink-soft">{t.intro}</p>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>{t.columnas.documento}</Th>
            <Th>{t.columnas.estado}</Th>
            <Th>{t.columnas.fecha}</Th>
            <Th className="min-w-[260px]">{t.columnas.acciones}</Th>
          </tr>
        </thead>
        <tbody>
          {documentos.map((resumen) => (
            <DocumentoRow
              key={resumen.tipo}
              resumen={resumen}
              esAdmin={esAdmin}
              onAviso={onAviso}
              onEliminar={setAEliminar}
            />
          ))}
        </tbody>
      </Table>
      <EliminarDialog documento={aEliminar} onClose={() => setAEliminar(null)} onAviso={onAviso} />
    </section>
  );
}

function DocumentoRow({
  resumen,
  esAdmin,
  onAviso,
  onEliminar,
}: {
  resumen: ResumenDocumento;
  esAdmin: boolean;
  onAviso: (mensaje: string) => void;
  onEliminar: (documento: DocumentoFila) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, startUpload] = useTransition();
  const [descargando, startDownload] = useTransition();
  const nombre = copy.documentos.tipos[resumen.tipo];
  const mostrado = resumen.pendiente ?? resumen.rechazado ?? resumen.vigente;

  function descargar(documento: DocumentoFila) {
    setError(null);
    startDownload(async () => {
      const result = await obtenerUrlDocumento({ documentoId: documento.id });
      if (!result.ok || !result.data) {
        setError(result.ok ? copy.documentos.errors.downloadFailed : result.error);
        return;
      }
      // The link is an attachment: the browser downloads the file and the page
      // stays. (A new window opened after this await would be blocked as a popup.)
      window.location.assign(result.data.url);
    });
  }

  function elegido(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    // Checked here for immediate feedback, and again on the server against
    // the stored object.
    const valid = validateDocumentoUpload({
      tipo: resumen.tipo,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    if (!valid.ok) {
      setError(valid.error);
      return;
    }
    startUpload(async () => {
      // subir never throws, so the transition always ends (no stuck spinner).
      const error = await subir(resumen.tipo, file);
      if (error) {
        setError(error);
        return;
      }
      onAviso(esAdmin ? t.exito.subidoAdmin : t.exito.subido);
    });
  }

  return (
    <tr className={rowClassName(false)} data-testid={`documento-${resumen.tipo}`}>
      <Td>
        <div>{nombre}</div>
        <div className="text-[12.5px] text-ink-soft">{resumen.requerido ? t.requerido : t.opcional}</div>
      </Td>
      <Td>
        <div className="flex flex-col items-start gap-1.5">
          <StatusBadge label={t.estados[resumen.estado]} tone={resumen.estado === "aprobado" ? "active" : "secondary"} />
          {resumen.rechazado?.motivoRechazo ? (
            <span className="text-[12.5px] italic text-accent-deep">
              {formatCopy(t.motivoRechazo, { motivo: resumen.rechazado.motivoRechazo })}
            </span>
          ) : null}
          {resumen.pendiente && resumen.vigente ? (
            <span className="text-[12.5px] italic text-ink-soft">{t.vigenteNota}</span>
          ) : null}
        </div>
      </Td>
      <Td className="whitespace-nowrap tabular-nums text-ink-soft">
        {mostrado ? formatearFechaHora(mostrado.creadoEn) : ""}
      </Td>
      <Td>
        <div className="flex flex-wrap gap-2 *:whitespace-nowrap">
          {resumen.vigente ? (
            <Button variant="secondary" onClick={() => descargar(resumen.vigente!)} disabled={descargando}>
              {t.descargar}
            </Button>
          ) : null}
          {resumen.pendiente ? (
            <>
              <Button variant="secondary" onClick={() => descargar(resumen.pendiente!)} disabled={descargando}>
                {t.descargarPendiente}
              </Button>
              <Button variant="secondary" onClick={() => onEliminar(resumen.pendiente!)}>
                {t.eliminar}
              </Button>
            </>
          ) : null}
          {resumen.puedeSubir ? (
            <>
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                aria-label={formatCopy(t.archivoLabel, { documento: nombre })}
                onChange={elegido}
              />
              <Button onClick={() => input.current?.click()} disabled={subiendo}>
                {subiendo ? t.subiendo : resumen.estado === "faltante" ? t.subir : t.subirNuevo}
              </Button>
            </>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-[12.5px] italic text-accent-deep">
            {error}
          </p>
        ) : null}
      </Td>
    </tr>
  );
}

// Upload: a path from the server, the file straight to Storage with the
// user's session, then the server records it; a failed registration discards
// the object (src/lib/documentos/subida.ts). Returns an es-AR error or null.
function subir(tipo: DocumentoTipo, file: File): Promise<string | null> {
  return subirDocumento(
    {
      preparar: prepararSubidaDocumento,
      subirArchivo: (path) =>
        createClient().storage.from(DOCUMENTOS_BUCKET).upload(path, file, { contentType: file.type, upsert: false }),
      registrar: registrarDocumento,
      descartar: descartarSubida,
    },
    tipo,
    file,
  );
}

function EliminarDialog({
  documento,
  onClose,
  onAviso,
}: {
  documento: DocumentoFila | null;
  onClose: () => void;
  onAviso: (mensaje: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmar() {
    if (!documento) return;
    startTransition(async () => {
      const result = await eliminarDocumentoPendiente({ documentoId: documento.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      onClose();
      onAviso(t.exito.eliminado);
    });
  }

  return (
    <Dialog
      open={documento !== null}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title={t.eliminarTitle}
    >
      <p className="text-ink-soft">
        {t.eliminarBody}
        {documento ? ` (${copy.documentos.tipos[documento.tipo]}: ${documento.fileName})` : ""}
      </p>
      {error ? (
        <p role="alert" className="text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {copy.miLegajo.pendiente.volver}
        </Button>
        <Button onClick={confirmar} disabled={pending}>
          {t.eliminar}
        </Button>
      </div>
    </Dialog>
  );
}
