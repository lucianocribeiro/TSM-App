"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { LabelValueGrid } from "@/components/ui/LabelValueGrid";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { copy } from "@/lib/copy/es-AR";
import { CAMPOS_LABORALES, valoresLaborales, type CampoLaboral, type FormLaboral } from "@/lib/legajo/laborales";
import { ESTADOS_LABORALES } from "@/lib/legajo/options";
import { datosLaboralesSchema, fieldErrors } from "@/lib/legajo/validation";
import type { DatoLaboral } from "@/lib/legajo/vista";
import { actualizarDatosLaborales } from "../actions";

const t = copy.miLegajo;

type GrupoLaboralPanelProps = {
  profileId: string;
  laborales: DatoLaboral[];
  inicial: FormLaboral;
  onGuardado: (mensaje: string) => void;
};

// Group E (PRD 5.5), edited by the Admin directly. Antigüedad is shown,
// calculated from the fecha de ingreso, and never edited.
export function GrupoLaboralPanel({ profileId, laborales, inicial, onGuardado }: GrupoLaboralPanelProps) {
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
  onCancel,
  onSaved,
}: {
  profileId: string;
  inicial: FormLaboral;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormLaboral>(inicial);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (campo: CampoLaboral, value: string) => setForm((prev) => ({ ...prev, [campo]: value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const valores = valoresLaborales(form);
    // Immediate feedback with the same schema the server applies.
    const local = datosLaboralesSchema.safeParse(valores);
    if (!local.success) {
      setErrores(fieldErrors(local.error));
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
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {CAMPOS_LABORALES.map((campo) => {
          const common = {
            label: t.camposLaborales[campo],
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
          if (campo === "fecha_ingreso") {
            return <Field key={campo} {...common} type="date" onChange={(event) => set(campo, event.target.value)} />;
          }
          if (campo === "bruto_mensual") {
            return <Field key={campo} {...common} inputMode="decimal" onChange={(event) => set(campo, event.target.value)} />;
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
