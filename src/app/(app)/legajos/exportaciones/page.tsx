import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { rowClassName, Table, Td, Th } from "@/components/ui/Table";
import { listarCuentas } from "@/lib/admin/cuentas";
import { requireRole } from "@/lib/auth/require-role";
import { listarItems } from "@/lib/configuracion/datos";
import { nombresDeActores } from "@/lib/configuracion/historial";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { EXPORTACIONES_LIMITE, listarExportaciones } from "@/lib/exportacion/datos";
import { filaExportacion } from "@/lib/exportacion/historial";

const t = copy.exportacion.historial;

// Historial de exportaciones (CR-4): every Excel export of the Legajos list,
// newest first, read only. Admin only, as the rest of /legajos.
export default async function ExportacionesPage() {
  await requireRole("admin");
  const [registros, cuentas, items] = await Promise.all([listarExportaciones(), listarCuentas(), listarItems()]);
  // If the accounts cannot be read, every row shows the fallback copy; the
  // failure is logged once, without ids.
  if (!cuentas.ok) console.error("[legajos/exportaciones] account lookup failed; actors shown as unavailable");
  const nombres = nombresDeActores(cuentas.ok ? (cuentas.data ?? []) : []);
  const filas = (registros ?? []).map((registro) => filaExportacion(registro, nombres, items ?? []));

  return (
    <>
      <PageHeader
        kicker={t.kicker}
        title={t.title}
        actions={
          <Link href="/legajos" className={buttonClassName("secondary")}>
            {t.volver}
          </Link>
        }
      />
      <div className="flex flex-col gap-4 px-[34px] pb-10 pt-[26px]">
        <p className="text-ink-soft">{t.intro}</p>
        {registros === null ? (
          <Panel>
            <p role="alert" className="text-accent-deep">
              {t.fallo}
            </p>
          </Panel>
        ) : filas.length === 0 ? (
          <Panel>
            <p className="text-ink-soft">{t.vacio}</p>
          </Panel>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>{t.columnas.fecha}</Th>
                  <Th>{t.columnas.usuario}</Th>
                  <Th>{t.columnas.cantidad}</Th>
                  <Th>{t.columnas.campos}</Th>
                  <Th>{t.columnas.hijos}</Th>
                  <Th>{t.columnas.filtros}</Th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <tr key={fila.id} data-testid="exportacion-row" className={rowClassName(false)}>
                    <Td className="whitespace-nowrap tabular-nums text-ink-soft">
                      <div>{fila.fecha}</div>
                      {fila.completada ? null : <StatusBadge label={t.noCompletada} tone="secondary" />}
                    </Td>
                    <Td className="break-all text-ink-soft">{fila.usuario}</Td>
                    <Td className="tabular-nums">{fila.cantidad}</Td>
                    <Td className="min-w-[220px]">{fila.campos}</Td>
                    <Td>{fila.hijos}</Td>
                    <Td className="min-w-[180px] text-ink-soft">{fila.filtros}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {filas.length >= EXPORTACIONES_LIMITE ? (
              <p className="text-[12.5px] italic text-ink-soft">{formatCopy(t.limite, { n: String(EXPORTACIONES_LIMITE) })}</p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
