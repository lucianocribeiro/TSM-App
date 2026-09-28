"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { rowClassName, Table, Td, Th } from "@/components/ui/Table";
import type { ActionResult } from "@/lib/action-result";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import type { ModoReemplazo } from "@/lib/documentos/reemplazo";
import type { DocumentoFila, ResumenDocumento } from "@/lib/documentos/resumen";
import { subirDocumento, type SubidaPasos } from "@/lib/documentos/subida";
import { DOCUMENTOS_BUCKET, type DocumentoTipo } from "@/lib/documentos/tipos";
import { validateDocumentoUpload } from "@/lib/documentos/validation";
import { formatearFechaHora } from "@/lib/format/fecha";
import { createClient } from "@/lib/supabase/client";

const t = copy.miLegajo.documentos;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

// The Server Actions behind the section: /mi-legajo's for the own legajo,
// /legajos' (bound to the employee) for an Admin acting on any legajo.
export type AccionesDocumentos = Pick<SubidaPasos, "preparar" | "registrar" | "descartar"> & {
  descargar: (input: { documentoId: string }) => Promise<ActionResult<{ url: string }>>;
  eliminar: (input: { documentoId: string }) => Promise<ActionResult>;
};

type DocumentosSectionProps = {
  documentos: ResumenDocumento[];
  acciones: AccionesDocumentos;
  // Admin uploads need no approval (success message).
  esAdmin: boolean;
  // Which file can be deleted: the own pending upload (/mi-legajo) or the
  // current approved document (Admin in /legajos).
  eliminable: "pendiente" | "vigente";
  intro: string;
  onAviso: (mensaje: string) => void;
};

export function DocumentosSection({ documentos, acciones, esAdmin, eliminable, intro, onAviso }: DocumentosSectionProps) {
  const [aEliminar, setAEliminar] = useState<DocumentoFila | null>(null);
  // A failed delete, shown under the table once the dialog closes. The table
  // itself shows the real state (after a failed object removal the document
  // is already gone from the legajo).
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);

  return (
    <section aria-labelledby="documentos-title" className="flex flex-col gap-3" data-testid="documentos">
      <div>
        <h2 id="documentos-title" className="text-[24px] font-normal leading-[1.1]">
          {t.title}
        </h2>
        <p className="mt-1 text-[12.5px] italic text-ink-soft">{intro}</p>
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
              acciones={acciones}
              esAdmin={esAdmin}
              eliminable={eliminable}
              onAviso={onAviso}
              onEliminar={(documento) => {
                setErrorEliminar(null);
                setAEliminar(documento);
              }}
            />
          ))}
        </tbody>
      </Table>
      {errorEliminar ? (
        <p role="alert" data-testid="documentos-error" className="text-[12.5px] italic text-accent-deep">
          {errorEliminar}
        </p>
      ) : null}
      <EliminarDialog
        documento={aEliminar}
        eliminar={acciones.eliminar}
        body={eliminable === "vigente" ? copy.legajos.documentos.eliminarVigenteBody : t.eliminarBody}
        onClose={() => setAEliminar(null)}
        onAviso={onAviso}
        onError={(mensaje) => {
          setAEliminar(null);
          setErrorEliminar(mensaje);
        }}
      />
    </section>
  );
}

function DocumentoRow({
  resumen,
  acciones,
  esAdmin,
  eliminable,
  onAviso,
  onEliminar,
}: {
  resumen: ResumenDocumento;
  acciones: AccionesDocumentos;
  esAdmin: boolean;
  eliminable: "pendiente" | "vigente";
  onAviso: (mensaje: string) => void;
  onEliminar: (documento: DocumentoFila) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, startUpload] = useTransition();
  const [descargando, startDownload] = useTransition();
  const [reemplazando, setReemplazando] = useState(false);
  const nombre = copy.documentos.tipos[resumen.tipo];
  const mostrado = resumen.pendiente ?? resumen.rechazado ?? resumen.vigente;
  // An Admin replaces a current document through the mode dialog (F1-09B);
  // nobody uploads over a pending one.
  const reemplazable = esAdmin && resumen.vigente !== null && resumen.pendiente === null;

  function descargar(documento: DocumentoFila) {
    setError(null);
    startDownload(async () => {
      const result = await acciones.descargar({ documentoId: documento.id });
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
    if (file) procesar(file);
  }

  function procesar(file: File, modo?: ModoReemplazo) {
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
      const error = await subir(acciones, resumen.tipo, file, modo);
      if (error) {
        setError(error);
        return;
      }
      onAviso(modo ? copy.legajos.documentos.reemplazado : esAdmin ? t.exito.subidoAdmin : t.exito.subido);
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
            <>
              <Button variant="secondary" onClick={() => descargar(resumen.vigente!)} disabled={descargando}>
                {t.descargar}
              </Button>
              {eliminable === "vigente" ? (
                <Button variant="secondary" onClick={() => onEliminar(resumen.vigente!)}>
                  {t.eliminar}
                </Button>
              ) : null}
            </>
          ) : null}
          {resumen.pendiente ? (
            <>
              <Button variant="secondary" onClick={() => descargar(resumen.pendiente!)} disabled={descargando}>
                {t.descargarPendiente}
              </Button>
              {eliminable === "pendiente" ? (
                <Button variant="secondary" onClick={() => onEliminar(resumen.pendiente!)}>
                  {t.eliminar}
                </Button>
              ) : null}
            </>
          ) : null}
          {reemplazable ? (
            <>
              <Button onClick={() => setReemplazando(true)} disabled={subiendo}>
                {subiendo ? t.subiendo : copy.legajos.documentos.reemplazar}
              </Button>
              <ReemplazarDialog
                open={reemplazando}
                nombre={nombre}
                vigente={resumen.vigente}
                onClose={() => setReemplazando(false)}
                onArchivo={(file, modo) => {
                  setReemplazando(false);
                  procesar(file, modo);
                }}
              />
            </>
          ) : resumen.puedeSubir ? (
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
// the object (src/lib/documentos/subida.ts). modo: an Admin replacing the
// current document. Returns an es-AR error or null.
function subir(acciones: AccionesDocumentos, tipo: DocumentoTipo, file: File, modo?: ModoReemplazo): Promise<string | null> {
  return subirDocumento(
    {
      preparar: acciones.preparar,
      subirArchivo: (path) =>
        createClient().storage.from(DOCUMENTOS_BUCKET).upload(path, file, { contentType: file.type, upsert: false }),
      registrar: (input) => acciones.registrar(modo ? { ...input, modo } : input),
      descartar: acciones.descartar,
    },
    tipo,
    file,
  );
}

// The Admin's replacement: keep the current document in the history, or
// delete it for good after an explicit confirmation. The file input lives
// inside the dialog (the page behind a modal is inert) and only appears once
// the choice is final.
function ReemplazarDialog({
  open,
  nombre,
  vigente,
  onClose,
  onArchivo,
}: {
  open: boolean;
  nombre: string;
  vigente: DocumentoFila | null;
  onClose: () => void;
  onArchivo: (file: File, modo: ModoReemplazo) => void;
}) {
  const r = copy.legajos.documentos;
  const input = useRef<HTMLInputElement>(null);
  const [modo, setModo] = useState<ModoReemplazo>("conservar");
  const [confirmando, setConfirmando] = useState(false);
  const archivo = vigente?.fileName ?? "";
  const listo = modo === "conservar" || confirmando;

  function cerrar() {
    setModo("conservar");
    setConfirmando(false);
    onClose();
  }

  function elegido(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const elegidoModo = modo;
    setModo("conservar");
    setConfirmando(false);
    onArchivo(file, elegidoModo);
  }

  return (
    <Dialog open={open} onClose={cerrar} title={confirmando ? r.confirmarTitle : formatCopy(r.reemplazarTitle, { documento: nombre })}>
      {confirmando ? (
        <p className="text-ink-soft" data-testid="reemplazo-confirmacion">
          {formatCopy(r.confirmarBody, { archivo })}
        </p>
      ) : (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-ink-soft">{formatCopy(r.reemplazarBody, { archivo })}</legend>
          {(["conservar", "definitivo"] as const).map((opcion) => (
            <label
              key={opcion}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-line p-3 has-checked:border-accent"
            >
              <input
                type="radio"
                name="modo-reemplazo"
                value={opcion}
                checked={modo === opcion}
                onChange={() => setModo(opcion)}
                className="mt-1 size-4 cursor-pointer accent-accent"
              />
              <span className="flex flex-col gap-0.5">
                <span>{r[opcion].label}</span>
                <span className="text-[12.5px] italic text-ink-soft">{r[opcion].descripcion}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {listo ? (
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label={formatCopy(t.archivoLabel, { documento: nombre })}
          onChange={elegido}
        />
      ) : null}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={confirmando ? () => setConfirmando(false) : cerrar}>
          {r.volver}
        </Button>
        {modo === "definitivo" && !confirmando ? (
          <Button onClick={() => setConfirmando(true)}>{r.definitivo.label}</Button>
        ) : (
          <Button onClick={() => input.current?.click()}>{confirmando ? r.confirmar : r.elegirArchivo}</Button>
        )}
      </div>
    </Dialog>
  );
}

function EliminarDialog({
  documento,
  eliminar,
  body,
  onClose,
  onAviso,
  onError,
}: {
  documento: DocumentoFila | null;
  eliminar: AccionesDocumentos["eliminar"];
  body: string;
  onClose: () => void;
  onAviso: (mensaje: string) => void;
  // A failed delete closes the dialog and hands the es-AR error to the section.
  onError: (mensaje: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  function confirmar() {
    if (!documento) return;
    startTransition(async () => {
      let result: Awaited<ReturnType<AccionesDocumentos["eliminar"]>>;
      try {
        result = await eliminar({ documentoId: documento.id });
      } catch {
        result = { ok: false, error: t.errors.eliminarFallo };
      }
      if (!result.ok) {
        onError(result.error);
        return;
      }
      onClose();
      onAviso(t.exito.eliminado);
    });
  }

  return (
    <Dialog
      open={documento !== null}
      onClose={onClose}
      title={t.eliminarTitle}
    >
      <p className="text-ink-soft">
        {body}
        {documento ? ` (${copy.documentos.tipos[documento.tipo]}: ${documento.fileName})` : ""}
      </p>
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
