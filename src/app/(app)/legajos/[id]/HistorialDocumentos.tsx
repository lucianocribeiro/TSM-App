"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Table, Td, Th, rowClassName } from "@/components/ui/Table";
import type { ActionResult } from "@/lib/action-result";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import type { HistorialTipo } from "@/lib/documentos/historial";
import { formatearFechaHora } from "@/lib/format/fecha";

const t = copy.legajos.documentos.historial;

// Replaced versions of each document type (Admin only; F1-09B). Shown only
// for types that have history. Downloads use a 5-minute signed URL.
export function HistorialDocumentos({
  historial,
  descargar,
}: {
  historial: HistorialTipo[];
  descargar: (input: { documentoId: string }) => Promise<ActionResult<{ url: string }>>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (historial.length === 0) return null;

  function bajar(documentoId: string) {
    setError(null);
    startTransition(async () => {
      const result = await descargar({ documentoId }).catch(() => null);
      if (!result?.ok || !result.data) {
        setError(result && !result.ok ? result.error : copy.documentos.errors.downloadFailed);
        return;
      }
      window.location.assign(result.data.url);
    });
  }

  return (
    <section className="flex flex-col gap-4" data-testid="historial-documentos">
      <p className="text-[12.5px] italic text-ink-soft">{t.intro}</p>
      {historial.map(({ tipo, versiones }) => (
        <div key={tipo} className="flex flex-col gap-2" data-testid={`historial-${tipo}`}>
          <h3 className="text-[20px] font-normal leading-[1.1]">
            {formatCopy(t.title, { documento: copy.documentos.tipos[tipo] })}
          </h3>
          <Table>
            <thead>
              <tr>
                <Th>{t.columnas.archivo}</Th>
                <Th>{t.columnas.cargado}</Th>
                <Th>{t.columnas.reemplazado}</Th>
                <Th>{t.columnas.quien}</Th>
                <Th>{t.columnas.acciones}</Th>
              </tr>
            </thead>
            <tbody>
              {versiones.map((version) => (
                <tr key={version.id} className={rowClassName(false)} data-testid="historial-version">
                  <Td className="break-all">{version.fileName}</Td>
                  <Td className="whitespace-nowrap tabular-nums text-ink-soft">{formatearFechaHora(version.creadoEn)}</Td>
                  <Td className="whitespace-nowrap tabular-nums text-ink-soft">
                    {version.reemplazadoEn ? formatearFechaHora(version.reemplazadoEn) : t.sinDato}
                  </Td>
                  <Td className="text-ink-soft">{version.reemplazadoPor ?? t.sinDato}</Td>
                  <Td>
                    <Button variant="secondary" onClick={() => bajar(version.id)} disabled={pending}>
                      {copy.miLegajo.documentos.descargar}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}
    </section>
  );
}
