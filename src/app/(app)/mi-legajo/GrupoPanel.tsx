"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { LabelValueGrid } from "@/components/ui/LabelValueGrid";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import type { CampoSolicitud } from "@/lib/aprobaciones/campos";
import type { LegajoActual } from "@/lib/aprobaciones/solicitudes";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { camposDelGrupo, ESQUEMA_GRUPO, type GrupoEditable } from "@/lib/legajo/grupos";
import { ESTADOS_CIVILES, PARTIDO_OTRO, PARTIDOS } from "@/lib/legajo/options";
import { fieldErrors } from "@/lib/legajo/validation";
import { formInicial, mostrarHijo, mostrarValor, valorActual, valoresDelForm, type FormState } from "@/lib/legajo/vista";
import { actualizarLegajoPropio, enviarSolicitud } from "./actions";

const t = copy.miLegajo;
const labels = copy.aprobaciones.campos;

type GrupoPanelProps = {
  grupo: GrupoEditable;
  actual: LegajoActual;
  // Proposed values of the pending request, by field.
  propuestos: Map<string, string | null>;
  // A request is pending: nothing can be edited until it is decided.
  bloqueado: boolean;
  esAdmin: boolean;
  onGuardado: (mensaje: string) => void;
};

export function GrupoPanel({ grupo, actual, propuestos, bloqueado, esAdmin, onGuardado }: GrupoPanelProps) {
  const campos = camposDelGrupo(grupo);
  const [editando, setEditando] = useState(false);
  const titleId = `grupo-${grupo}-title`;

  return (
    <Panel aria-labelledby={titleId} data-testid={`grupo-${grupo}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-[24px] font-normal leading-[1.1]">
          {t.grupos[grupo]}
        </h2>
        {!editando ? (
          <Button variant="secondary" onClick={() => setEditando(true)} disabled={bloqueado} aria-describedby={titleId}>
            {t.editar}
          </Button>
        ) : null}
      </div>
      <div className="mt-4">
        {editando ? (
          <GrupoForm
            grupo={grupo}
            campos={campos}
            actual={actual}
            esAdmin={esAdmin}
            onCancel={() => setEditando(false)}
            onSaved={(mensaje) => {
              setEditando(false);
              onGuardado(mensaje);
            }}
          />
        ) : (
          <LabelValueGrid
            items={campos
              .filter((campo) => campo !== "partido_otro" || actual.partido === PARTIDO_OTRO || propuestos.has(campo))
              .map((campo) => ({
                key: campo,
                label: labels[campo],
                value: campo === "hijos" ? <HijosLista hijos={actual.hijos} /> : mostrarValor(campo, valorActual(actual, campo)),
                note: propuestos.has(campo)
                  ? formatCopy(t.pendiente.valor, { valor: mostrarValor(campo, propuestos.get(campo) ?? null) })
                  : undefined,
              }))}
          />
        )}
      </div>
    </Panel>
  );
}

function HijosLista({ hijos }: { hijos: LegajoActual["hijos"] }) {
  if (hijos.length === 0) return <span>{t.hijos.ninguno}</span>;
  return (
    <ul className="flex flex-col gap-1">
      {hijos.map((hijo) => (
        <li key={`${hijo.nombre_completo}-${hijo.fecha_nacimiento}`}>{mostrarHijo(hijo)}</li>
      ))}
    </ul>
  );
}

function GrupoForm({
  grupo,
  campos,
  actual,
  esAdmin,
  onCancel,
  onSaved,
}: {
  grupo: GrupoEditable;
  campos: CampoSolicitud[];
  actual: LegajoActual;
  esAdmin: boolean;
  onCancel: () => void;
  onSaved: (mensaje: string) => void;
}) {
  const [form, setForm] = useState<FormState>(() => formInicial(campos, actual));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (campo: string, value: string) => setForm((prev) => ({ ...prev, campos: { ...prev.campos, [campo]: value } }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const valores = valoresDelForm(grupo, form);
    // Immediate feedback with the same schema the server applies.
    const local = ESQUEMA_GRUPO[grupo].safeParse(valores);
    if (!local.success) {
      setErrores(fieldErrors(local.error));
      setError(t.errors.revisarCampos);
      return;
    }
    setErrores({});
    setError(null);
    startTransition(async () => {
      const action = esAdmin ? actualizarLegajoPropio : enviarSolicitud;
      const result = await action({ grupo, valores });
      if (!result.ok) {
        setErrores(result.fieldErrors ?? {});
        setError(result.error);
        return;
      }
      onSaved(esAdmin ? t.exito.guardado : t.exito.enviada);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {campos.map((campo) => (
          <CampoInput key={campo} campo={campo} form={form} errores={errores} set={set} />
        ))}
      </div>
      {grupo === "C" && form.campos.tiene_hijos === "si" ? (
        <HijosEditor form={form} setForm={setForm} errores={errores} />
      ) : null}
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

function CampoInput({
  campo,
  form,
  errores,
  set,
}: {
  campo: CampoSolicitud;
  form: FormState;
  errores: Record<string, string>;
  set: (campo: string, value: string) => void;
}) {
  const value = form.campos[campo] ?? "";
  const common = {
    label: labels[campo],
    name: campo,
    value,
    error: errores[campo],
  };

  switch (campo) {
    case "hijos":
      return null;
    case "partido":
      return (
        <Select
          {...common}
          placeholder={t.elegir}
          options={PARTIDOS.map((partido) => ({ value: partido, label: partido }))}
          onChange={(event) => set(campo, event.target.value)}
        />
      );
    case "partido_otro":
      return form.campos.partido === PARTIDO_OTRO ? (
        <Field {...common} onChange={(event) => set(campo, event.target.value)} />
      ) : null;
    case "estado_civil":
      return (
        <Select
          {...common}
          placeholder={t.elegir}
          options={ESTADOS_CIVILES.map((estado) => ({ value: estado, label: t.estadosCiviles[estado] }))}
          onChange={(event) => set(campo, event.target.value)}
        />
      );
    case "tiene_hijos":
      return (
        <Select
          {...common}
          placeholder={t.elegir}
          options={[
            { value: "si", label: t.siNo.si },
            { value: "no", label: t.siNo.no },
          ]}
          onChange={(event) => set(campo, event.target.value)}
        />
      );
    case "fecha_nacimiento":
      return <Field {...common} type="date" onChange={(event) => set(campo, event.target.value)} />;
    case "email_personal":
      return <Field {...common} type="email" autoComplete="email" onChange={(event) => set(campo, event.target.value)} />;
    case "telefono_celular":
    case "emergencia_telefono":
      return <Field {...common} type="tel" onChange={(event) => set(campo, event.target.value)} />;
    case "dni":
      return <Field {...common} inputMode="numeric" onChange={(event) => set(campo, event.target.value)} />;
    case "cuil":
      return <Field {...common} placeholder={t.cuilPlaceholder} onChange={(event) => set(campo, event.target.value)} />;
    default:
      return <Field {...common} onChange={(event) => set(campo, event.target.value)} />;
  }
}

function HijosEditor({
  form,
  setForm,
  errores,
}: {
  form: FormState;
  setForm: (update: (prev: FormState) => FormState) => void;
  errores: Record<string, string>;
}) {
  const update = (index: number, campo: "nombre_completo" | "fecha_nacimiento", value: string) =>
    setForm((prev) => ({
      ...prev,
      hijos: prev.hijos.map((hijo, i) => (i === index ? { ...hijo, [campo]: value } : hijo)),
    }));

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-line-soft p-4">
      <legend className="px-1 text-[10.5px] uppercase tracking-[.16em] text-ink-soft">{labels.hijos}</legend>
      {form.hijos.map((hijo, index) => (
        <div
          key={index}
          data-testid="hijo-row"
          className="grid items-end gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]"
        >
          <Field
            label={`${formatCopy(t.hijos.hijoN, { n: String(index + 1) })} · ${t.hijos.nombre}`}
            value={hijo.nombre_completo}
            error={errores[`hijos.${index}.nombre_completo`]}
            onChange={(event) => update(index, "nombre_completo", event.target.value)}
          />
          <Field
            label={`${formatCopy(t.hijos.hijoN, { n: String(index + 1) })} · ${t.hijos.fecha}`}
            type="date"
            value={hijo.fecha_nacimiento}
            error={errores[`hijos.${index}.fecha_nacimiento`]}
            onChange={(event) => update(index, "fecha_nacimiento", event.target.value)}
          />
          <div>
            <Button
              variant="secondary"
              onClick={() => setForm((prev) => ({ ...prev, hijos: prev.hijos.filter((_, i) => i !== index) }))}
            >
              {t.hijos.quitar}
            </Button>
          </div>
        </div>
      ))}
      {errores.hijos ? <p className="text-[12.5px] italic text-accent-deep">{errores.hijos}</p> : null}
      <div>
        <Button
          variant="secondary"
          onClick={() => setForm((prev) => ({ ...prev, hijos: [...prev.hijos, { nombre_completo: "", fecha_nacimiento: "" }] }))}
        >
          {t.hijos.agregar}
        </Button>
      </div>
    </fieldset>
  );
}
