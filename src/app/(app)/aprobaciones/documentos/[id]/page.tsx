import { notFound } from "next/navigation";
import { z } from "zod";
import { Banner } from "@/components/ui/Banner";
import { Panel } from "@/components/ui/Panel";
import { requireRole } from "@/lib/auth/require-role";
import { cargarDocumento, type ArchivoDocumento } from "@/lib/aprobaciones/bandeja-datos";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { createDocumentoSignedUrl } from "@/lib/documentos/signed-url";
import { formatearFechaHora } from "@/lib/format/fecha";
import { DecisionPanel } from "../../DecisionPanel";
import { DetalleEncabezado, DetalleNoDisponible } from "../../DetalleEncabezado";
import { DescargarDocumento } from "./DescargarDocumento";

const t = copy.aprobaciones.detalle;

type DocumentoPageProps = { params: Promise<{ id: string }> };

// One pending document, previewed beside the approved one of its type (PRD
// US-7). Previews use 5-minute signed URLs made with the Admin's session;
// storage paths never reach the page.
export default async function DocumentoPage({ params }: DocumentoPageProps) {
  const admin = await requireRole("admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const documento = await cargarDocumento(id);
  if (documento === "no-encontrado") return <DetalleNoDisponible mensaje={t.noEncontrado} />;
  if (!documento) return <DetalleNoDisponible mensaje={t.cargaFallo} />;
  if (documento.estado !== "pendiente") return <DetalleNoDisponible mensaje={copy.aprobaciones.errors.yaDecidido} />;

  const propio = documento.empleado.profileId === admin.id;
  const nombreTipo = copy.documentos.tipos[documento.tipo];
  const [enviado, vigente] = await Promise.all([
    vistaPrevia(documento),
    documento.vigente ? vistaPrevia(documento.vigente) : null,
  ]);

  return (
    <DetalleEncabezado
      empleado={documento.empleado}
      titulo={formatCopy(copy.aprobaciones.bandeja.tipoDocumento, { documento: nombreTipo })}
      enviadoEn={documento.creadoEn}
      propio={propio}
    >
      <Banner>{t.notaDocumento}</Banner>
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        <ArchivoPanel titulo={t.documento.enviado} archivo={documento} url={enviado} nombreTipo={nombreTipo} testId="archivo-enviado" />
        {documento.vigente ? (
          <ArchivoPanel
            titulo={t.documento.vigente}
            archivo={documento.vigente}
            url={vigente}
            nombreTipo={nombreTipo}
            testId="archivo-vigente"
          />
        ) : (
          <Panel data-testid="archivo-vigente">
            <h2 className="text-[20px] font-normal leading-[1.1]">{t.documento.vigente}</h2>
            <p className="mt-3 text-ink-soft">{t.documento.sinVigente}</p>
          </Panel>
        )}
      </div>
      {propio ? null : <DecisionPanel clase="documento" id={documento.id} />}
    </DetalleEncabezado>
  );
}

async function vistaPrevia(archivo: ArchivoDocumento): Promise<string | null> {
  const result = await createDocumentoSignedUrl(archivo.storagePath);
  return result.ok && result.data ? result.data.url : null;
}

function ArchivoPanel({
  titulo,
  archivo,
  url,
  nombreTipo,
  testId,
}: {
  titulo: string;
  archivo: ArchivoDocumento;
  url: string | null;
  nombreTipo: string;
  testId: string;
}) {
  const alt = formatCopy(t.documento.vistaPrevia, { documento: nombreTipo });
  return (
    <Panel data-testid={testId} className="flex flex-col gap-3">
      <h2 className="text-[20px] font-normal leading-[1.1]">{titulo}</h2>
      <div className="text-[12.5px] text-ink-soft">
        <div className="break-all">{archivo.fileName}</div>
        <div className="tabular-nums">{formatearFechaHora(archivo.creadoEn)}</div>
      </div>
      <div className="overflow-hidden rounded-md border border-line-soft bg-bg">
        {url && archivo.mimeType.startsWith("image/") ? (
          // A short-lived signed URL of a private bucket: next/image would
          // need the storage host in the config and would cache the file.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={alt} className="max-h-[480px] w-full object-contain" />
        ) : url && archivo.mimeType === "application/pdf" ? (
          <object data={url} type="application/pdf" aria-label={alt} className="h-[480px] w-full">
            <p className="p-4 text-[12.5px] italic text-ink-soft">{t.documento.sinVistaPrevia}</p>
          </object>
        ) : (
          <p className="p-4 text-[12.5px] italic text-ink-soft">{t.documento.sinVistaPrevia}</p>
        )}
      </div>
      <DescargarDocumento documentoId={archivo.id} />
    </Panel>
  );
}
