"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { KpiStrip } from "@/components/ui/KpiStrip";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { rowClassName, Table, Td, Th } from "@/components/ui/Table";
import { copy } from "@/lib/copy/es-AR";
import { copyLaborales } from "@/lib/copy/laborales";
import { formatCopy } from "@/lib/copy/format";
import type { CatalogoItem } from "@/lib/configuracion/listas";
import type { Opcion } from "@/lib/legajo/laborales";
import {
  filtrarLegajos,
  FILTROS_INICIALES,
  opcionesFiltro,
  type FiltrosLegajos,
  type LegajoListItem,
} from "@/lib/legajo/listado";
import type { KpisLegajos } from "@/lib/legajo/kpis";
import { ESTADOS_LABORALES } from "@/lib/legajo/options";

const t = copy.legajos;
const tl = copyLaborales.listado;

type LegajosScreenProps = {
  legajos: LegajoListItem[];
  // The Configuración lists, for the filter options.
  items: CatalogoItem[];
  listaFallo: boolean;
  // Whole workforce, from the server; null when the list could not be read.
  kpis: KpisLegajos | null;
};

export function LegajosScreen({ legajos, items, listaFallo, kpis }: LegajosScreenProps) {
  const router = useRouter();
  const [filtros, setFiltros] = useState<FiltrosLegajos>(FILTROS_INICIALES);

  const visibles = useMemo(() => filtrarLegajos(legajos, filtros), [legajos, filtros]);
  // Options from Configuración (plus inactive items still in use).
  const opciones = useMemo(
    () => ({
      area: opcionesFiltro(items, legajos, "area"),
      sucursal: opcionesFiltro(items, legajos, "sucursal"),
      tarea: opcionesFiltro(items, legajos, "tarea"),
    }),
    [items, legajos],
  );
  // The total the count refers to: deactivated accounts only when shown.
  const total = filtros.mostrarBajas ? legajos.length : legajos.filter((item) => item.estadoCuenta === "activa").length;
  const set = <K extends keyof FiltrosLegajos>(key: K, value: FiltrosLegajos[K]) =>
    setFiltros((prev) => ({ ...prev, [key]: value }));
  const hayFiltros = JSON.stringify(filtros) !== JSON.stringify(FILTROS_INICIALES);

  return (
    <>
      <PageHeader kicker={t.kicker} title={t.title} />
      <div className="flex flex-col gap-4 px-[34px] pb-10 pt-[26px]">
        {kpis ? (
          <KpiStrip
            label={t.kpis.label}
            className="mb-2"
            items={[
              { key: "activos", label: t.kpis.activos, value: kpis.activos },
              { key: "ingresos-del-mes", label: t.kpis.ingresosDelMes, value: kpis.ingresosDelMes },
            ]}
          />
        ) : null}
        <div role="search" aria-label={t.filtros.label} className="flex flex-col gap-3">
          <div className="grid items-end gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
            <div className="[grid-column:span_2] max-[560px]:[grid-column:auto]">
              <Field
                label={t.busqueda.label}
                type="search"
                placeholder={tl.busquedaPlaceholder}
                value={filtros.busqueda}
                onChange={(event) => set("busqueda", event.target.value)}
              />
            </div>
            <Select
              label={tl.filtros.estadoLaboral}
              placeholder={t.filtros.todos}
              value={filtros.estadoLaboral}
              onChange={(event) => {
                const value = ESTADOS_LABORALES.find((estado) => estado === event.target.value);
                set("estadoLaboral", value ?? "");
              }}
              options={ESTADOS_LABORALES.map((estado) => ({ value: estado, label: copyLaborales.estados[estado] }))}
            />
            <FiltroLista label={tl.filtros.area} opciones={opciones.area} value={filtros.areaId} onChange={(v) => set("areaId", v)} />
            <FiltroLista
              label={tl.filtros.sucursal}
              opciones={opciones.sucursal}
              value={filtros.sucursalId}
              onChange={(v) => set("sucursalId", v)}
            />
            <FiltroLista label={tl.filtros.tarea} opciones={opciones.tarea} value={filtros.tareaId} onChange={(v) => set("tareaId", v)} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Checkbox
              label={t.filtros.mostrarBajas}
              checked={filtros.mostrarBajas}
              onChange={(event) => set("mostrarBajas", event.target.checked)}
            />
            <div className="flex flex-wrap items-center gap-3">
              {!listaFallo && legajos.length > 0 ? (
                <p role="status" className="text-[12.5px] italic text-ink-soft tabular-nums">
                  {formatCopy(t.total, { n: String(visibles.length), total: String(total) })}
                </p>
              ) : null}
              {hayFiltros ? (
                <Button variant="secondary" onClick={() => setFiltros(FILTROS_INICIALES)}>
                  {t.filtros.limpiar}
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {listaFallo ? (
          <Panel>
            <p role="alert" className="text-accent-deep">
              {t.listaFallo}
            </p>
          </Panel>
        ) : visibles.length === 0 ? (
          <Panel>
            <p className="text-ink-soft">{legajos.length === 0 ? t.vacio : t.sinResultados}</p>
          </Panel>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.columnas.empleado}</Th>
                <Th>{t.columnas.cuil}</Th>
                <Th>{tl.columnas.area}</Th>
                <Th>{tl.columnas.puesto}</Th>
                <Th>{tl.columnas.sucursal}</Th>
                <Th>{tl.columnas.tarea}</Th>
                <Th>{tl.columnas.estadoLaboral}</Th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((item) => (
                <LegajoRow key={item.profileId} item={item} onOpen={(href) => router.push(href)} />
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}

function FiltroLista({
  label,
  opciones,
  value,
  onChange,
}: {
  label: string;
  opciones: Opcion[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      label={label}
      placeholder={t.filtros.todas}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={opciones}
    />
  );
}

function LegajoRow({ item, onOpen }: { item: LegajoListItem; onOpen: (href: string) => void }) {
  const href = `/legajos/${item.profileId}`;
  const baja = item.estadoCuenta !== "activa";
  const dato = (value: string | null) => value || t.sinDato;

  return (
    <tr
      data-testid="legajo-row"
      data-baja={baja ? "true" : undefined}
      className={rowClassName(true)}
      onClick={() => onOpen(href)}
    >
      <Td className="min-w-[220px]">
        <div className={baja ? "text-ink-soft" : undefined}>
          <Link
            href={href}
            // One prefetch per row would mean one server render per legajo;
            // the detail loads on click instead.
            prefetch={false}
            className="text-inherit no-underline hover:text-accent-deep"
            onClick={(event) => event.stopPropagation()}
          >
            {item.nombre ?? <span className="italic text-ink-soft">{t.sinNombre}</span>}
          </Link>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-soft tabular-nums">
          {item.numeroLegajo ? <span>{formatCopy(tl.numeroLegajo, { numero: item.numeroLegajo })}</span> : null}
          {baja ? <StatusBadge label={t.dadoDeBaja} tone="secondary" /> : null}
        </div>
      </Td>
      <Td className="whitespace-nowrap tabular-nums text-ink-soft">{dato(item.cuil)}</Td>
      <Td className="text-ink-soft">{dato(item.area)}</Td>
      <Td className="text-ink-soft">{dato(item.puesto)}</Td>
      <Td className="text-ink-soft">{dato(item.sucursal)}</Td>
      <Td className="text-ink-soft">{dato(item.tarea)}</Td>
      <Td>
        {item.estadoLaboral ? (
          <StatusBadge
            label={copyLaborales.estados[item.estadoLaboral]}
            tone={item.estadoLaboral === "activo" ? "active" : "secondary"}
          />
        ) : (
          <span className="text-ink-soft">{t.sinDato}</span>
        )}
      </Td>
    </tr>
  );
}
