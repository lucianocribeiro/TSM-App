import Link from "next/link";
import { Banner } from "@/components/ui/Banner";
import { buttonClassName } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { rowClassName, Table, Td, Th } from "@/components/ui/Table";
import { rutaItem, type ItemBandeja } from "@/lib/aprobaciones/bandeja";
import { mensajeResultado, type ResultadoDecision } from "@/lib/aprobaciones/resultado";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { formatearFechaHora } from "@/lib/format/fecha";

const t = copy.aprobaciones.bandeja;

type AprobacionesScreenProps = {
  items: ItemBandeja[];
  listaFallo: boolean;
  // The decision just made, confirmed here.
  resultado: ResultadoDecision | null;
};

export function AprobacionesScreen({ items, listaFallo, resultado }: AprobacionesScreenProps) {
  return (
    <>
      <PageHeader kicker={t.kicker} title={t.title} />
      <div className="flex flex-col gap-4 px-[34px] pb-10 pt-[26px]">
        <p className="text-[12.5px] italic text-ink-soft">{t.intro}</p>
        {resultado ? (
          <Banner>
            <span data-testid="resultado-decision">{mensajeResultado(resultado)}</span>
          </Banner>
        ) : null}
        {listaFallo ? (
          <Panel>
            <p role="alert" className="text-accent-deep">
              {t.listaFallo}
            </p>
          </Panel>
        ) : items.length === 0 ? (
          <Panel>
            <p className="text-ink-soft" data-testid="bandeja-vacia">
              {t.vacio}
            </p>
          </Panel>
        ) : (
          <>
            <p className="text-[12.5px] text-ink-soft tabular-nums">{formatCopy(t.total, { n: String(items.length) })}</p>
            <Table>
              <thead>
                <tr>
                  <Th>{t.columnas.empleado}</Th>
                  <Th>{t.columnas.pendiente}</Th>
                  <Th>{t.columnas.enviado}</Th>
                  <Th>{t.columnas.acciones}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <ItemRow key={`${item.clase}-${item.id}`} item={item} />
                ))}
              </tbody>
            </Table>
          </>
        )}
      </div>
    </>
  );
}

function descripcion(item: ItemBandeja): string {
  if (item.clase === "documento") return formatCopy(t.tipoDocumento, { documento: copy.documentos.tipos[item.tipo] });
  const grupos = item.grupos.map((grupo) => copy.miLegajo.grupos[grupo]).join(", ");
  return formatCopy(t.tipoSolicitud, { grupos });
}

function ItemRow({ item }: { item: ItemBandeja }) {
  const href = rutaItem(item);
  return (
    <tr className={rowClassName(false)} data-testid="bandeja-item" data-clase={item.clase} data-baja={item.dadoDeBaja ? "true" : undefined}>
      <Td className="min-w-[220px]">
        <div className={item.dadoDeBaja ? "text-ink-soft" : undefined}>
          {item.nombre ?? <span className="italic text-ink-soft">{t.sinNombre}</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-soft tabular-nums">
          {item.numeroLegajo ? <span>{formatCopy(t.numeroLegajo, { numero: item.numeroLegajo })}</span> : null}
          {item.dadoDeBaja ? <StatusBadge label={t.dadoDeBaja} tone="secondary" /> : null}
          {item.propio ? <StatusBadge label={t.propio} tone="secondary" /> : null}
        </div>
      </Td>
      <Td>{descripcion(item)}</Td>
      <Td className="whitespace-nowrap tabular-nums text-ink-soft">{formatearFechaHora(item.enviadoEn)}</Td>
      <Td>
        <Link href={href} prefetch={false} className={buttonClassName("secondary", "whitespace-nowrap")}>
          {t.revisar}
        </Link>
      </Td>
    </tr>
  );
}
