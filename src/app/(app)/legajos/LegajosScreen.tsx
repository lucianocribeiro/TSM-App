"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { rowClassName, Table, Td, Th } from "@/components/ui/Table";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import {
  filtrarLegajos,
  FILTROS_INICIALES,
  opcionesDistintas,
  type FiltrosLegajos,
  type LegajoListItem,
} from "@/lib/legajo/listado";
import { ESTADOS_LABORALES } from "@/lib/legajo/options";

const t = copy.legajos;

type LegajosScreenProps = {
  legajos: LegajoListItem[];
  listaFallo: boolean;
};

export function LegajosScreen({ legajos, listaFallo }: LegajosScreenProps) {
  const router = useRouter();
  const [filtros, setFiltros] = useState<FiltrosLegajos>(FILTROS_INICIALES);

  const visibles = useMemo(() => filtrarLegajos(legajos, filtros), [legajos, filtros]);
  // Options from the values present (free text today).
  const opciones = useMemo(
    () => ({
      area: opcionesDistintas(legajos, "area"),
      sede: opcionesDistintas(legajos, "sede"),
      modalidad: opcionesDistintas(legajos, "modalidad"),
    }),
    [legajos],
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
        <div role="search" aria-label={t.filtros.label} className="flex flex-col gap-3">
          <div className="grid items-end gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
            <div className="[grid-column:span_2] max-[560px]:[grid-column:auto]">
              <Field
                label={t.busqueda.label}
                type="search"
                placeholder={t.busqueda.placeholder}
                value={filtros.busqueda}
                onChange={(event) => set("busqueda", event.target.value)}
              />
            </div>
            <Select
              label={t.filtros.estadoLaboral}
              placeholder={t.filtros.todos}
              value={filtros.estadoLaboral}
              onChange={(event) => {
                const value = ESTADOS_LABORALES.find((estado) => estado === event.target.value);
                set("estadoLaboral", value ?? "");
              }}
              options={ESTADOS_LABORALES.map((estado) => ({ value: estado, label: copy.miLegajo.estadosLaborales[estado] }))}
            />
            <FiltroTexto label={t.filtros.area} opciones={opciones.area} value={filtros.area} onChange={(v) => set("area", v)} />
            <FiltroTexto label={t.filtros.sede} opciones={opciones.sede} value={filtros.sede} onChange={(v) => set("sede", v)} />
            <FiltroTexto
              label={t.filtros.modalidad}
              opciones={opciones.modalidad}
              value={filtros.modalidad}
              onChange={(v) => set("modalidad", v)}
            />
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
                <Th>{t.columnas.area}</Th>
                <Th>{t.columnas.puesto}</Th>
                <Th>{t.columnas.sede}</Th>
                <Th>{t.columnas.modalidad}</Th>
                <Th>{t.columnas.estadoLaboral}</Th>
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

function FiltroTexto({
  label,
  opciones,
  value,
  onChange,
}: {
  label: string;
  opciones: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      label={label}
      placeholder={t.filtros.todas}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={opciones.map((opcion) => ({ value: opcion, label: opcion }))}
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
          {item.numeroLegajo ? <span>{formatCopy(t.numeroLegajo, { numero: item.numeroLegajo })}</span> : null}
          {baja ? <StatusBadge label={t.dadoDeBaja} tone="secondary" /> : null}
        </div>
      </Td>
      <Td className="whitespace-nowrap tabular-nums text-ink-soft">{dato(item.cuil)}</Td>
      <Td className="text-ink-soft">{dato(item.area)}</Td>
      <Td className="text-ink-soft">{dato(item.puesto)}</Td>
      <Td className="text-ink-soft">{dato(item.sede)}</Td>
      <Td className="text-ink-soft">{dato(item.modalidad)}</Td>
      <Td>
        {item.estadoLaboral ? (
          <StatusBadge
            label={copy.miLegajo.estadosLaborales[item.estadoLaboral]}
            tone={item.estadoLaboral === "activo" ? "active" : "secondary"}
          />
        ) : (
          <span className="text-ink-soft">{t.sinDato}</span>
        )}
      </Td>
    </tr>
  );
}
