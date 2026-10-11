"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { CAMPOS_EXPORTACION, camposDelGrupo, GRUPOS_EXPORTACION, type CampoExportacion } from "@/lib/exportacion/campos";
import type { FiltrosLegajos } from "@/lib/legajo/listado";
import { exportarLegajos } from "./actions";

const t = copy.exportacion;
const TODOS = CAMPOS_EXPORTACION.map((config) => config.campo);
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// The Excel export (CR-4): the Admin picks the fields, grouped A to E (plus
// the children, as a second sheet), and the server builds the file for the
// list's current filters and search. Only the list state and the field keys
// are sent; the file comes back and is saved by the browser.
export function ExportarDialog({
  open,
  onClose,
  filtros,
  cantidad,
  onAviso,
}: {
  open: boolean;
  onClose: () => void;
  filtros: FiltrosLegajos;
  // Employees the list shows now.
  cantidad: number;
  onAviso: (mensaje: string) => void;
}) {
  const [elegidos, setElegidos] = useState<ReadonlySet<CampoExportacion>>(new Set());
  const [hijos, setHijos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportando, startExport] = useTransition();

  const todos = elegidos.size === TODOS.length && hijos;
  const poner = (campos: readonly CampoExportacion[], valor: boolean) =>
    setElegidos((previos) => {
      const nuevos = new Set(previos);
      for (const campo of campos) {
        if (valor) nuevos.add(campo);
        else nuevos.delete(campo);
      }
      return nuevos;
    });

  function cerrar() {
    setError(null);
    onClose();
  }

  function exportar() {
    if (elegidos.size === 0) {
      setError(t.dialogo.requerido);
      return;
    }
    setError(null);
    startExport(async () => {
      let result: Awaited<ReturnType<typeof exportarLegajos>>;
      try {
        result = await exportarLegajos({ filtros, seleccion: { campos: [...elegidos], hijos } });
      } catch {
        result = { ok: false, error: t.errors.fallo };
      }
      if (!result.ok || !result.data) {
        setError(result.ok ? t.errors.fallo : result.error);
        return;
      }
      guardar(result.data.nombre, result.data.contenido);
      onClose();
      onAviso(t.exito);
    });
  }

  return (
    <Dialog open={open} onClose={cerrar} title={t.dialogo.title} className="max-w-[760px]">
      <p className="text-ink-soft">{t.dialogo.intro}</p>
      <p className="tabular-nums" data-testid="exportar-cantidad">
        {cantidad === 1 ? t.dialogo.cantidadUno : formatCopy(t.dialogo.cantidad, { n: String(cantidad) })}
      </p>
      <Checkbox
        label={t.dialogo.seleccionarTodos}
        checked={todos}
        onChange={(event) => {
          poner(TODOS, event.target.checked);
          setHijos(event.target.checked);
        }}
      />
      <div className="flex flex-col gap-4">
        {GRUPOS_EXPORTACION.map(({ grupo, titulo }) => {
          const campos = camposDelGrupo(grupo);
          return (
            <fieldset key={grupo} className="rounded-md border border-line p-3" data-testid={`exportar-grupo-${grupo}`}>
              <legend className="px-1 text-[13px] text-ink-soft">{titulo}</legend>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => poner(campos, true)} aria-label={`${titulo}: ${t.dialogo.grupoTodo}`}>
                  {t.dialogo.grupoTodo}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    poner(campos, false);
                    if (grupo === "C") setHijos(false);
                  }}
                  aria-label={`${titulo}: ${t.dialogo.grupoNinguno}`}
                >
                  {t.dialogo.grupoNinguno}
                </Button>
              </div>
              <div className="mt-1 grid gap-x-4 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
                {campos.map((campo) => (
                  <Checkbox
                    key={campo}
                    label={CAMPOS_EXPORTACION.find((config) => config.campo === campo)!.label}
                    checked={elegidos.has(campo)}
                    onChange={(event) => poner([campo], event.target.checked)}
                  />
                ))}
                {grupo === "C" ? (
                  <div className="flex flex-col">
                    <Checkbox label={t.dialogo.hijos} checked={hijos} onChange={(event) => setHijos(event.target.checked)} />
                    <span className="-mt-1.5 text-[12.5px] italic text-ink-soft">{t.dialogo.hijosNota}</span>
                  </div>
                ) : null}
              </div>
            </fieldset>
          );
        })}
      </div>
      {cantidad === 0 ? <p className="text-[12.5px] italic text-ink-soft">{t.errors.sinEmpleados}</p> : null}
      {error ? (
        <p role="alert" className="text-[12.5px] italic text-accent-deep">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={cerrar}>
          {t.dialogo.cancelar}
        </Button>
        <Button onClick={exportar} disabled={exportando || cantidad === 0}>
          {exportando ? t.dialogo.exportando : t.dialogo.exportar}
        </Button>
      </div>
    </Dialog>
  );
}

// Saves the file the server returned (base64) under its name.
function guardar(nombre: string, contenido: string) {
  const bytes = Uint8Array.from(atob(contenido), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
