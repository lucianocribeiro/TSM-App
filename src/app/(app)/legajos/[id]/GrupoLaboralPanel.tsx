"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { LabelValueGrid } from "@/components/ui/LabelValueGrid";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import type { CatalogoItem } from "@/lib/configuracion/listas";
import { copy } from "@/lib/copy/es-AR";
import { copyLaborales } from "@/lib/copy/laborales";
import { formatCopy } from "@/lib/copy/format";
import {
  bloqueadoSinConvenio,
  cambiarCampoLaboral,
  CAMPOS_LABORALES,
  CAMPOS_OBLIGATORIOS,
  esCampoLista,
  opcionesCampo,
  validarDatosLaborales,
  valoresLaborales,
  type ActualLaboral,
  type CampoLaboral,
  type DatoLaboral,
  type FormLaboral,
} from "@/lib/legajo/laborales";
import { ESTADOS_LABORALES } from "@/lib/legajo/options";
import { actualizarDatosLaborales } from "../actions";

const t = copy.miLegajo;
const tl = copyLaborales.form;

// The label of each form field (the list fields by their list's name).
const ETIQUETA: Record<CampoLaboral, keyof typeof copyLaborales.campos> = {
  numero_legajo: "numero_legajo",
  area_id: "area",
  puesto_id: "puesto",
  fecha_ingreso: "fecha_ingreso",
  estado_laboral: "estado_laboral",
  sucursal_id: "sucursal",
  convenio_id: "convenio",
  tarea_id: "tarea",
  categoria_id: "categoria",
};

type GrupoLaboralPanelProps = {
  profileId: string;
  laborales: DatoLaboral[];
  inicial: FormLaboral;
  // The stored values, which stay valid even if their item is inactive now.
  actual: ActualLaboral | null;
  // The Configuración lists.
  items: CatalogoItem[];
  onGuardado: (mensaje: string) => void;
};

// Group E (PRD 5.5), Admin only, edited directly. The list fields are
// dropdowns of Configuración; antigüedad is shown, calculated from the fecha
// de ingreso, and never edited. Picking a Puesto prefills its Sucursal por
// defecto; the "No" convenio disables and clears Tarea and Categoría (CR-5).
export function GrupoLaboralPanel({ profileId, laborales, inicial, actual, items, onGuardado }: GrupoLaboralPanelProps) {
  const [editando, setEditando] = useState(false);
  const titleId = "grupo-E-title";

  return (
    <Panel aria-labelledby={titleId} data-testid="grupo-E">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-[24px] font-normal leading-[1.1]">
          {copyLaborales.grupo}
        </h2>
        {!editando ? (
          <Button variant="secondary" onClick={() => setEditando(true)} aria-describedby={titleId}>
            {t.editar}
          </Button>
        ) : null}
      </div>
      <div className="mt-4">
        {editando ? (
          <LaboralForm
            profileId={profileId}
            inicial={inicial}
            actual={actual}
            items={items}
            onCancel={() => setEditando(false)}
            onSaved={() => {
              setEditando(false);
              onGuardado(t.exito.guardado);
            }}
          />
        ) : (
          <LabelValueGrid
            items={laborales.map((dato) => ({ key: dato.key, label: copyLaborales.campos[dato.key], value: dato.value }))}
          />
        )}
      </div>
    </Panel>
  );
}

function LaboralForm({
  profileId,
  inicial,
  actual,
  items,
  onCancel,
  onSaved,
}: {
  profileId: string;
  inicial: FormLaboral;
  actual: ActualLaboral | null;
  items: CatalogoItem[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormLaboral>(inicial);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The Admin's change, with its effects on other fields (cambiarCampoLaboral).
  const set = (campo: CampoLaboral, value: string) => setForm((prev) => cambiarCampoLaboral(prev, campo, value, items));

  function submit(event: FormEvent) {
    event.preventDefault();
    const valores = valoresLaborales(form);
    // Immediate feedback with the same validator the server applies.
    const local = validarDatosLaborales(valores, items, actual);
    if (!local.ok) {
      setErrores(local.fieldErrors);
      setError(t.errors.revisarCampos);
      return;
    }
    setErrores({});
    setError(null);
    startTransition(async () => {
      const result = await actualizarDatosLaborales({ profileId, valores });
      if (!result.ok) {
        setErrores(result.fieldErrors ?? {});
        setError(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="text-[12.5px] italic text-ink-soft">{tl.obligatoriosNota}</p>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {CAMPOS_LABORALES.map((campo) => {
          const etiqueta = copyLaborales.campos[ETIQUETA[campo]];
          const common = {
            label: CAMPOS_OBLIGATORIOS.has(campo) ? formatCopy(tl.obligatorio, { campo: etiqueta }) : etiqueta,
            name: campo,
            value: form[campo],
            error: errores[campo],
          };
          if (campo === "estado_laboral") {
            return (
              <Select
                key={campo}
                {...common}
                placeholder={t.elegir}
                options={ESTADOS_LABORALES.map((estado) => ({ value: estado, label: copyLaborales.estados[estado] }))}
                onChange={(event) => set(campo, event.target.value)}
              />
            );
          }
          if (esCampoLista(campo)) {
            const sinArea = campo === "puesto_id" && !form.area_id;
            // With the "No" convenio, Tarea and Categoría are disabled once
            // empty. A legajo saved before CR-5 may still have one: it stays
            // editable so the Admin can empty it (the save refuses it).
            const sinConvenio = bloqueadoSinConvenio(form, campo, items);
            const select = (
              <Select
                key={campo}
                {...common}
                placeholder={sinArea ? tl.elegirAreaPrimero : t.elegir}
                disabled={sinArea || (sinConvenio && !form[campo])}
                options={opcionesCampo(items, campo, { actual: actual?.[campo], areaId: form.area_id || null })}
                onChange={(event) => set(campo, event.target.value)}
              />
            );
            if (!sinConvenio) return select;
            return (
              <div key={campo} className="flex flex-col gap-1">
                {select}
                <p className="text-[12.5px] italic text-ink-soft">{tl.sinConvenioNota}</p>
              </div>
            );
          }
          if (campo === "fecha_ingreso") {
            return <Field key={campo} {...common} type="date" onChange={(event) => set(campo, event.target.value)} />;
          }
          return <Field key={campo} {...common} onChange={(event) => set(campo, event.target.value)} />;
        })}
      </div>
      <p className="text-[12.5px] italic text-ink-soft">{tl.antiguedadNota}</p>
      {error ? (
        <p role="alert" className="text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t.cancelar}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t.guardando : t.guardar}
        </Button>
      </div>
    </form>
  );
}
