import { notFound } from "next/navigation";
import { z } from "zod";
import { Banner } from "@/components/ui/Banner";
import { Panel } from "@/components/ui/Panel";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/require-role";
import { cargarSolicitud } from "@/lib/aprobaciones/bandeja-datos";
import { construirComparacion, type CambioHijo, type GrupoComparacion } from "@/lib/aprobaciones/comparacion";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { formatearFecha } from "@/lib/format/fecha";
import { mostrarHijo, mostrarValor } from "@/lib/legajo/vista";
import { DecisionPanel } from "../../DecisionPanel";
import { DetalleEncabezado, DetalleNoDisponible } from "../../DetalleEncabezado";

const t = copy.aprobaciones.detalle;

type SolicitudPageProps = { params: Promise<{ id: string }> };

// One pending change request, compared field by field with the current
// legajo (PRD US-7). It is approved or rejected as a whole.
export default async function SolicitudPage({ params }: SolicitudPageProps) {
  const admin = await requireRole("admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const solicitud = await cargarSolicitud(id);
  if (solicitud === "no-encontrado") return <DetalleNoDisponible mensaje={t.noEncontrado} />;
  if (!solicitud) return <DetalleNoDisponible mensaje={t.cargaFallo} />;
  if (solicitud.estado !== "pendiente") return <DetalleNoDisponible mensaje={copy.aprobaciones.errors.yaDecidido} />;

  const propio = solicitud.empleado.profileId === admin.id;
  const grupos = construirComparacion(solicitud.items, solicitud.actual);

  return (
    <DetalleEncabezado empleado={solicitud.empleado} titulo={t.solicitudTitle} enviadoEn={solicitud.enviadoEn} propio={propio}>
      <Banner>{t.nota}</Banner>
      {grupos.map((grupo) => (
        <GrupoPanel key={grupo.grupo} grupo={grupo} />
      ))}
      {propio ? null : <DecisionPanel clase="solicitud" id={solicitud.id} />}
    </DetalleEncabezado>
  );
}

function GrupoPanel({ grupo }: { grupo: GrupoComparacion }) {
  const sinCambios = grupo.filas.length === 0 && (grupo.hijos === null || grupo.hijos.length === 0);
  return (
    <Panel data-testid={`comparacion-${grupo.grupo}`} className="flex flex-col gap-4">
      <h2 className="text-[24px] font-normal leading-[1.1]">{copy.miLegajo.grupos[grupo.grupo]}</h2>
      {sinCambios ? <p className="text-ink-soft">{t.sinDiferencias}</p> : null}
      {grupo.filas.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <Th>{t.columnas.campo}</Th>
              <Th>{t.columnas.actual}</Th>
              <Th>{t.columnas.propuesto}</Th>
            </tr>
          </thead>
          <tbody>
            {grupo.filas.map((fila) => (
              <tr key={fila.campo} data-campo={fila.campo}>
                <Td className="text-ink-soft">{copy.aprobaciones.campos[fila.campo]}</Td>
                <Td data-valor="actual">{mostrarValor(fila.campo, fila.actual)}</Td>
                <Td data-valor="propuesto" className="text-accent-deep">
                  {mostrarValor(fila.campo, fila.propuesto)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {grupo.hijos && grupo.hijos.length > 0 ? <HijosCambios cambios={grupo.hijos} /> : null}
    </Panel>
  );
}

function HijosCambios({ cambios }: { cambios: CambioHijo[] }) {
  return (
    <div data-testid="comparacion-hijos">
      <h3 className="text-[10.5px] uppercase tracking-[.16em] text-ink-soft">{t.hijos.title}</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {cambios.map((cambio, index) => (
          <li key={`${cambio.tipo}-${index}`} data-cambio={cambio.tipo} className="flex flex-wrap gap-x-2 text-[14px]">
            <span className="text-ink-soft">{t.hijos[cambio.tipo]}</span>
            <span className={cambio.tipo === "quitado" ? "line-through" : "text-accent-deep"}>{mostrarHijo(cambio.hijo)}</span>
            {cambio.tipo === "modificado" ? (
              <span className="text-ink-soft">{formatCopy(t.hijos.antes, { fecha: formatearFecha(cambio.fechaAnterior) })}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
