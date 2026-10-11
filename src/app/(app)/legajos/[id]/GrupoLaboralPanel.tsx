"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { LabelValueGrid } from "@/components/ui/LabelValueGrid";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import type { CatalogoItem } from "@/lib/configuracion/listas";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import {
  CAMPOS_LABORALES,
  CAMPOS_OBLIGATORIOS,
  esCampoLista,
  opcionesCampo,
  validarDatosLaborales,
  valoresLaborales,
  type ActualLaboral,
  type CampoLaboral,
  type FormLaboral,
} from "@/lib/legajo/laborales";
import { ESTADOS_LABORALES } from "@/lib/legajo/options";
import type { DatoLaboral } from "@/lib/legajo/vista";
import { actualizarDatosLaborales } from "../actions";

const t = copy.miLegajo;
const tl = copy.legajos.laborales;

// The label of each form field (the list fields by their list's name).
const ETIQUETA: Record<CampoLaboral, keyof typeof t.camposLaborales> = {
  numero_legajo: "numero_legajo",
  area_id: "area",
  puesto_id: "puesto",
  fecha_ingreso: "fecha_ingreso",
  estado_laboral: "estado_laboral",
  sucursal_id: "sucursal",
  tarea_id: "tarea",
  convenio_id: "convenio",
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
// de ingreso, and never edited.
export function GrupoLaboralPanel({ profileId, laborales, inicial, actual, items, onGuardado }: GrupoLaboralPanelProps) {
  const [editando, setEditando] = useState(false);
  const titleId = "grupo-E-title";

  return (
    <Panel aria-labelledby={titleId} data-testid="grupo-E">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-[24px] font-normal leading-[1.1]">
          {t.grupos.E}
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
            items={laborales.map((dato) => ({ key: dato.key, label: t.camposLaborales[dato.key], value: dato.value }))}
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

  // A new Área clears the Puesto: Puestos belong to one Área.
  const set = (campo: CampoLaboral, value: string) =>
    setForm((prev) => (campo === "area_id" && value !== prev.area_id ? { ...prev, area_id: value, puesto_id: "" } : { ...prev, [campo]: value }));

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
          const etiqueta = t.camposLaborales[ETIQUETA[campo]];
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
                options={ESTADOS_LABORALES.map((estado) => ({ value: estado, label: t.estadosLaborales[estado] }))}
                onChange={(event) => set(campo, event.target.value)}
              />
            );
          }
          if (esCampoLista(campo)) {
            const sinArea = campo === "puesto_id" && !form.area_id;
            return (
              <Select
                key={campo}
                {...common}
                placeholder={sinArea ? tl.elegirAreaPrimero : t.elegir}
                disabled={sinArea}
                options={opcionesCampo(items, campo, { actual: actual?.[campo], areaId: form.area_id || null })}
                onChange={(event) => set(campo, event.target.value)}
              />
            );
          }
          if (campo === "fecha_ingreso") {
            return <Field key={campo} {...common} type="date" onChange={(event) => set(campo, event.target.value)} />;
          }
          return <Field key={campo} {...common} onChange={(event) => set(campo, event.target.value)} />;
        })}
      </div>
      <p className="text-[12.5px] italic text-ink-soft">{copy.legajos.laborales.antiguedadNota}</p>
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
