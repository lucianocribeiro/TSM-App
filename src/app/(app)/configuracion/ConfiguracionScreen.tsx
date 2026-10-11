"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ActionResult } from "@/lib/action-result";
import { mensajeNombre } from "@/lib/configuracion/errores";
import {
  enUso,
  esLista,
  itemsDeGrupo,
  LISTAS,
  nombresDelGrupo,
  vecinoDe,
  type CatalogoItem,
  type CatalogoLista,
  type Direccion,
} from "@/lib/configuracion/listas";
import { NOMBRE_MAX, validarNombre } from "@/lib/configuracion/nombre";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { agregarItem, desactivarItem, eliminarItem, moverItem, reactivarItem, renombrarItem } from "./actions";

const t = copy.configuracion;

type DialogState = { kind: "renombrar" | "desactivar" | "eliminar"; item: CatalogoItem } | null;
type Aviso = { ok: boolean; texto: string } | null;

type ConfiguracionScreenProps = {
  items: CatalogoItem[];
  // Ids of the items some legajo references: in use, so not deletable.
  enUsoIds: string[];
  listaFallo: boolean;
  listaInicial: CatalogoLista;
};

export function ConfiguracionScreen({ items, enUsoIds, listaFallo, listaInicial }: ConfiguracionScreenProps) {
  const router = useRouter();
  const referenciados = useMemo(() => new Set(enUsoIds), [enUsoIds]);
  const [lista, setLista] = useState<CatalogoLista>(listaInicial);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [pending, startTransition] = useTransition();

  function elegirLista(valor: string) {
    if (!esLista(valor)) return;
    setLista(valor);
    setAviso(null);
    window.history.replaceState(null, "", `?lista=${valor}`);
  }

  // Runs an action, shows its outcome and reloads the lists: after a
  // failure too, since a concurrent change is the usual cause. A form or
  // dialog that passes alTerminar shows its own error.
  function ejecutar(accion: () => Promise<ActionResult>, exito: string, alTerminar?: (result: ActionResult) => void) {
    startTransition(async () => {
      const result = await accion();
      if (result.ok) setAviso({ ok: true, texto: exito });
      else setAviso(alTerminar ? null : { ok: false, texto: result.error });
      alTerminar?.(result);
      router.refresh();
    });
  }

  const acciones: AccionesItem = {
    pending,
    mover: (item, direccion) =>
      ejecutar(() => moverItem({ id: item.id, version: item.version, direccion }), formatCopy(t.exito.movido, { nombre: item.nombre })),
    reactivar: (item) =>
      ejecutar(() => reactivarItem({ id: item.id, version: item.version }), formatCopy(t.exito.reactivado, { nombre: item.nombre })),
    abrir: (kind, item) => setDialog({ kind, item }),
  };

  const areas = itemsDeGrupo(items, "area");

  return (
    <>
      <PageHeader
        kicker={t.kicker}
        title={t.title}
        actions={
          <Link href="/configuracion/historial" className={buttonClassName("secondary")}>
            {t.acciones.verHistorial}
          </Link>
        }
      />
      <div className="flex flex-col gap-4 px-[34px] pb-10 pt-[26px]">
        <p className="text-ink-soft">{t.intro}</p>

        {listaFallo ? (
          <Panel>
            <p role="alert" className="text-accent-deep">
              {t.listaFallo}
            </p>
          </Panel>
        ) : (
          <>
            <div className="w-full max-w-[320px]">
              <Select
                label={t.selectorLabel}
                value={lista}
                onChange={(event) => elegirLista(event.target.value)}
                options={LISTAS.map((valor) => ({ value: valor, label: t.titulos[valor] }))}
              />
            </div>

            {aviso ? (
              <p role={aviso.ok ? "status" : "alert"} className={aviso.ok ? "text-[12.5px] italic text-ink-soft" : "text-[12.5px] italic text-accent-deep"}>
                {aviso.texto}
              </p>
            ) : null}

            <Panel data-testid={`lista-${lista}`} className="flex flex-col gap-5">
              <h2 className="text-[24px] font-normal leading-[1.1]">{t.titulos[lista]}</h2>
              {lista === "puesto" ? (
                <>
                  <p className="text-[12.5px] italic text-ink-soft">{t.puestoHint}</p>
                  {areas.length === 0 ? <p className="text-ink-soft">{t.sinAreas}</p> : null}
                  {areas.map((area) => (
                    <section key={area.id} aria-label={area.nombre} className="flex flex-col gap-3 border-t border-line-soft pt-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[20px] font-normal leading-[1.15]">{area.nombre}</h3>
                        {area.activo ? null : <StatusBadge label={t.estados.inactivo} tone="secondary" />}
                      </div>
                      {area.activo ? null : <p className="text-[12.5px] italic text-ink-soft">{t.areaInactiva}</p>}
                      <ListaItems items={items} referenciados={referenciados} grupo={itemsDeGrupo(items, "puesto", area.id)} vacio={t.areaVacia} acciones={acciones} />
                      <AgregarForm
                        key={`puesto-${area.id}`}
                        items={items}
                        lista="puesto"
                        area={area}
                        onAgregar={(nombre, alTerminar) =>
                          ejecutar(
                            () => agregarItem({ lista: "puesto", areaId: area.id, nombre }),
                            formatCopy(t.exito.agregado, { nombre }),
                            alTerminar,
                          )
                        }
                        pending={pending}
                      />
                    </section>
                  ))}
                </>
              ) : (
                <>
                  <ListaItems items={items} referenciados={referenciados} grupo={itemsDeGrupo(items, lista)} vacio={t.vacio} acciones={acciones} />
                  <AgregarForm
                    key={lista}
                    items={items}
                    lista={lista}
                    area={null}
                    onAgregar={(nombre, alTerminar) =>
                      ejecutar(() => agregarItem({ lista, nombre }), formatCopy(t.exito.agregado, { nombre }), alTerminar)
                    }
                    pending={pending}
                  />
                </>
              )}
            </Panel>
          </>
        )}
      </div>

      {dialog?.kind === "renombrar" ? (
        <RenombrarDialog
          key={dialog.item.id}
          items={items}
          item={dialog.item}
          pending={pending}
          onClose={() => setDialog(null)}
          onGuardar={(nombre, alTerminar) =>
            ejecutar(
              () => renombrarItem({ id: dialog.item.id, version: dialog.item.version, nombre }),
              formatCopy(t.exito.renombrado, { nombre }),
              alTerminar,
            )
          }
        />
      ) : null}
      {dialog?.kind === "desactivar" || dialog?.kind === "eliminar" ? (
        <ConfirmarDialog
          key={`${dialog.kind}-${dialog.item.id}`}
          kind={dialog.kind}
          item={dialog.item}
          pending={pending}
          onClose={() => setDialog(null)}
          onConfirmar={(alTerminar) =>
            dialog.kind === "desactivar"
              ? ejecutar(
                  () => desactivarItem({ id: dialog.item.id, version: dialog.item.version }),
                  formatCopy(t.exito.desactivado, { nombre: dialog.item.nombre }),
                  alTerminar,
                )
              : ejecutar(
                  () => eliminarItem({ id: dialog.item.id, version: dialog.item.version }),
                  formatCopy(t.exito.eliminado, { nombre: dialog.item.nombre }),
                  alTerminar,
                )
          }
        />
      ) : null}
    </>
  );
}

type AccionesItem = {
  pending: boolean;
  mover: (item: CatalogoItem, direccion: Direccion) => void;
  reactivar: (item: CatalogoItem) => void;
  abrir: (kind: "renombrar" | "desactivar" | "eliminar", item: CatalogoItem) => void;
};

function ListaItems({
  items,
  referenciados,
  grupo,
  vacio,
  acciones,
}: {
  items: CatalogoItem[];
  referenciados: ReadonlySet<string>;
  grupo: CatalogoItem[];
  vacio: string;
  acciones: AccionesItem;
}) {
  if (grupo.length === 0) return <p className="text-ink-soft">{vacio}</p>;
  return (
    <ul className="flex flex-col">
      {grupo.map((item) => (
        <li
          key={item.id}
          data-testid="catalogo-item"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-soft py-3 last:border-b-0"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="break-words">{item.nombre}</span>
            <StatusBadge label={item.activo ? t.estados.activo : t.estados.inactivo} tone={item.activo ? "active" : "secondary"} />
          </div>
          <div role="group" aria-label={formatCopy(t.acciones.grupo, { nombre: item.nombre })} className="flex flex-wrap gap-2">
            <BotonMover item={item} grupo={grupo} direccion="arriba" acciones={acciones} />
            <BotonMover item={item} grupo={grupo} direccion="abajo" acciones={acciones} />
            <Button variant="secondary" disabled={acciones.pending} onClick={() => acciones.abrir("renombrar", item)}>
              {t.acciones.renombrar}
            </Button>
            {item.activo ? (
              <Button variant="secondary" disabled={acciones.pending} onClick={() => acciones.abrir("desactivar", item)}>
                {t.acciones.desactivar}
              </Button>
            ) : (
              <Button variant="secondary" disabled={acciones.pending} onClick={() => acciones.reactivar(item)}>
                {t.acciones.reactivar}
              </Button>
            )}
            {enUso(items, item, referenciados) ? null : (
              <Button variant="secondary" disabled={acciones.pending} onClick={() => acciones.abrir("eliminar", item)}>
                {t.acciones.eliminar}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// Up or down one place; disabled at that end of the list.
function BotonMover({
  item,
  grupo,
  direccion,
  acciones,
}: {
  item: CatalogoItem;
  grupo: CatalogoItem[];
  direccion: Direccion;
  acciones: AccionesItem;
}) {
  const label = formatCopy(direccion === "arriba" ? t.acciones.subir : t.acciones.bajar, { nombre: item.nombre });
  return (
    <Button
      variant="secondary"
      aria-label={label}
      title={label}
      className="px-[9px]"
      disabled={acciones.pending || vecinoDe(grupo, item.id, direccion) === null}
      onClick={() => acciones.mover(item, direccion)}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className={direccion === "abajo" ? "size-4 rotate-180" : "size-4"}>
        <path d="M8 3.5 3 8.5h3.2V12.5h3.6V8.5H13z" fill="currentColor" />
      </svg>
    </Button>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-[12.5px] italic text-accent-deep">
      {error}
    </p>
  ) : null;
}

// A new item at the end of the list (of the Área, for a Puesto). The name is
// checked here with the same validator the action runs.
function AgregarForm({
  items,
  lista,
  area,
  onAgregar,
  pending,
}: {
  items: CatalogoItem[];
  lista: CatalogoLista;
  area: CatalogoItem | null;
  onAgregar: (nombre: string, alTerminar: (result: ActionResult) => void) => void;
  pending: boolean;
}) {
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const validado = validarNombre(nombre, nombresDelGrupo(items, lista, area?.id ?? null));
    if (!validado.ok) {
      setError(mensajeNombre(validado.error, lista));
      return;
    }
    setError(null);
    onAgregar(validado.nombre, (result) => {
      if (result.ok) setNombre("");
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-[220px]">
          <Field
            label={area ? formatCopy(t.agregar.labelPuesto, { area: area.nombre }) : t.agregar.label}
            name="nombre"
            autoComplete="off"
            maxLength={NOMBRE_MAX}
            value={nombre}
            error={error ?? undefined}
            onChange={(event) => setNombre(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending} className="mt-[21px]">
          {pending ? t.agregar.submitting : t.agregar.submit}
        </Button>
      </div>
      <p className="text-[12.5px] italic text-ink-soft">{t.nombreHint}</p>
    </form>
  );
}

function RenombrarDialog({
  items,
  item,
  pending,
  onClose,
  onGuardar,
}: {
  items: CatalogoItem[];
  item: CatalogoItem;
  pending: boolean;
  onClose: () => void;
  onGuardar: (nombre: string, alTerminar: (result: ActionResult) => void) => void;
}) {
  const [nombre, setNombre] = useState(item.nombre);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const validado = validarNombre(nombre, nombresDelGrupo(items, item.lista, item.areaId, item.id));
    if (!validado.ok) {
      setError(mensajeNombre(validado.error, item.lista));
      return;
    }
    setError(null);
    onGuardar(validado.nombre, (result) => {
      if (result.ok) onClose();
      else setError(result.error);
    });
  }

  return (
    <Dialog open onClose={onClose} title={formatCopy(t.renombrar.title, { nombre: item.nombre })}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-ink-soft">{t.renombrar.hint}</p>
        <Field
          label={t.renombrar.label}
          name="nombre"
          autoComplete="off"
          maxLength={NOMBRE_MAX}
          required
          value={nombre}
          onChange={(event) => setNombre(event.target.value)}
        />
        <p className="-mt-2 text-[12.5px] italic text-ink-soft">{t.nombreHint}</p>
        <ErrorLine error={error} />
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t.acciones.cancelar}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t.renombrar.saving : t.renombrar.confirm}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ConfirmarDialog({
  kind,
  item,
  pending,
  onClose,
  onConfirmar,
}: {
  kind: "desactivar" | "eliminar";
  item: CatalogoItem;
  pending: boolean;
  onClose: () => void;
  onConfirmar: (alTerminar: (result: ActionResult) => void) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const textos = t[kind];
  const cuerpo = kind === "desactivar" && item.lista === "area" ? t.desactivar.bodyArea : textos.body;

  function confirmar(event: FormEvent) {
    event.preventDefault();
    setError(null);
    onConfirmar((result) => {
      if (result.ok) onClose();
      else setError(result.error);
    });
  }

  return (
    <Dialog open onClose={onClose} title={formatCopy(textos.title, { nombre: item.nombre })}>
      <form onSubmit={confirmar} className="flex flex-col gap-4">
        <p className="text-ink-soft">{cuerpo}</p>
        <ErrorLine error={error} />
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t.acciones.cancelar}
          </Button>
          <Button type="submit" disabled={pending}>
            {textos.confirm}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
