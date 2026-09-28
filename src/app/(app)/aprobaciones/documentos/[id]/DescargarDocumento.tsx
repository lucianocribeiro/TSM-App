"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { copy } from "@/lib/copy/es-AR";
import { descargarDocumentoBandeja } from "../../actions";

// Downloads a document through a fresh 5-minute signed URL (attachment).
export function DescargarDocumento({ documentoId }: { documentoId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function descargar() {
    setError(null);
    startTransition(async () => {
      const result = await descargarDocumentoBandeja({ documentoId }).catch(() => null);
      if (!result?.ok || !result.data) {
        setError(result && !result.ok ? result.error : copy.documentos.errors.downloadFailed);
        return;
      }
      // An attachment: the browser downloads it and the page stays.
      window.location.assign(result.data.url);
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="secondary" onClick={descargar} disabled={pending}>
        {copy.aprobaciones.detalle.documento.descargar}
      </Button>
      {error ? (
        <p role="alert" className="text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}
    </div>
  );
}
