import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { rowClassName, Table, Td, Th } from "@/components/ui/Table";
import { listarCuentas } from "@/lib/admin/cuentas";
import { requireRole } from "@/lib/auth/require-role";
import { HISTORIAL_LIMITE, listarEventos } from "@/lib/configuracion/datos";
import { filaHistorial, nombresDeActores } from "@/lib/configuracion/historial";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";

const t = copy.configuracion.historial;

// The history of the Configuración lists (PRD "Configuración"), newest
// first, read only. Admin only, as the rest of the section.
export default async function ConfiguracionHistorialPage() {
  await requireRole("admin");
  const [eventos, cuentas] = await Promise.all([listarEventos(), listarCuentas()]);
  // Who did it. If the accounts cannot be read, every row shows the fallback
  // copy; the failure is logged once, without ids.
  if (!cuentas.ok) console.error("[configuracion/historial] account lookup failed; actors shown as unavailable");
  const nombres = nombresDeActores(cuentas.ok ? (cuentas.data ?? []) : []);
  const filas = (eventos ?? []).map((evento) => filaHistorial(evento, nombres));

  return (
    <>
      <PageHeader
        kicker={t.kicker}
        title={t.title}
        actions={
          <Link href="/configuracion" className={buttonClassName("secondary")}>
            {copy.configuracion.acciones.volver}
          </Link>
        }
      />
      <div className="flex flex-col gap-4 px-[34px] pb-10 pt-[26px]">
        <p className="text-ink-soft">{t.intro}</p>
        {eventos === null ? (
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
                  <Th>{t.columnas.lista}</Th>
                  <Th>{t.columnas.item}</Th>
                  <Th>{t.columnas.accion}</Th>
                  <Th>{t.columnas.antes}</Th>
                  <Th>{t.columnas.despues}</Th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <tr key={fila.id} data-testid="historial-row" className={rowClassName(false)}>
                    <Td className="whitespace-nowrap tabular-nums text-ink-soft">{fila.fecha}</Td>
                    <Td className="break-all text-ink-soft">{fila.usuario}</Td>
                    <Td className="whitespace-nowrap">{fila.lista}</Td>
                    <Td>{fila.item}</Td>
                    <Td className="whitespace-nowrap">{fila.accion}</Td>
                    <Td className="text-ink-soft">{fila.antes}</Td>
                    <Td className="text-ink-soft">{fila.despues}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {filas.length >= HISTORIAL_LIMITE ? (
              <p className="text-[12.5px] italic text-ink-soft">{formatCopy(t.limite, { n: String(HISTORIAL_LIMITE) })}</p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
