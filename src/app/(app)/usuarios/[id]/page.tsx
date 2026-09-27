import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { rowClassName, Table, Td, Th } from "@/components/ui/Table";
import { listarCuentas } from "@/lib/admin/cuentas";
import { requireRole } from "@/lib/auth/require-role";
import { copy } from "@/lib/copy/es-AR";
import { obtenerHistorial } from "@/lib/cuentas/historial";
import { formatearFechaHora } from "@/lib/format/fecha";

const t = copy.usuarios;

type DetallePageProps = { params: Promise<{ id: string }> };

// Account detail: the account's data and its history, read only (PRD US-8).
export default async function UsuarioDetallePage({ params }: DetallePageProps) {
  await requireRole("admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [cuentas, historial] = await Promise.all([listarCuentas(), obtenerHistorial(id)]);
  const lista = cuentas.ok ? (cuentas.data ?? []) : [];
  const cuenta = lista.find((item) => item.id === id);
  if (cuentas.ok && !cuenta) notFound();

  // Who did it: the name from their legajo, else their email.
  const nombres = new Map(lista.map((item) => [item.id, item.nombre ?? item.email]));

  return (
    <>
      <PageHeader
        kicker={t.detalle.kicker}
        title={cuenta?.nombre ?? cuenta?.email ?? t.title}
        actions={
          <Link href="/usuarios" className={buttonClassName("secondary")}>
            {t.detalle.volver}
          </Link>
        }
      />
      <div className="flex flex-col gap-6 px-[34px] pb-10 pt-[26px]">
        {cuenta ? (
          <Panel>
            <h2 className="text-[24px] font-normal leading-[1.1]">{t.detalle.datos}</h2>
            <dl className="mt-4 grid gap-x-[26px] gap-y-[18px] [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
              <Dato label={t.columnas.email} value={cuenta.email} />
              <Dato label={t.columnas.nombre} value={cuenta.nombre ?? t.sinNombre} />
              <Dato label={t.columnas.rol} value={copy.auth.roles[cuenta.rol]} />
              <div className="flex flex-col gap-1.5">
                <dt className="text-[10.5px] uppercase tracking-[.16em] text-ink-soft">{t.columnas.estado}</dt>
                <dd className="flex flex-col items-start gap-1.5">
                  <StatusBadge
                    label={copy.cuentas.estados[cuenta.estado]}
                    tone={cuenta.estado === "activa" ? "active" : "secondary"}
                  />
                  {cuenta.debeCambiarPassword ? (
                    <span className="text-[12.5px] italic text-ink-soft">{t.passwordPendiente}</span>
                  ) : null}
                </dd>
              </div>
            </dl>
          </Panel>
        ) : (
          <Panel>
            <p role="alert" className="text-accent-deep">
              {t.listaFallo}
            </p>
          </Panel>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-[24px] font-normal leading-[1.1]">{t.detalle.historial}</h2>
          {historial === null ? (
            <Panel>
              <p role="alert" className="text-accent-deep">
                {t.detalle.historialFallo}
              </p>
            </Panel>
          ) : historial.length === 0 ? (
            <Panel>
              <p className="text-ink-soft">{t.detalle.sinEventos}</p>
            </Panel>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t.detalle.columnas.evento}</Th>
                  <Th>{t.detalle.columnas.fecha}</Th>
                  <Th>{t.detalle.columnas.quien}</Th>
                  <Th>{t.detalle.columnas.motivo}</Th>
                </tr>
              </thead>
              <tbody>
                {historial.map((evento) => (
                  <tr key={evento.id} data-testid="evento-row" className={rowClassName(false)}>
                    <Td>{copy.cuentas.eventos[evento.tipo]}</Td>
                    <Td className="whitespace-nowrap tabular-nums text-ink-soft">{formatearFechaHora(evento.fecha)}</Td>
                    <Td className="text-ink-soft">{nombres.get(evento.actorId) ?? evento.actorId}</Td>
                    <Td className="text-ink-soft">{evento.motivo ?? ""}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      </div>
    </>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-[10.5px] uppercase tracking-[.16em] text-ink-soft">{label}</dt>
      <dd className="text-[15px]">{value}</dd>
    </div>
  );
}
