"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { rowClassName, Table, Td, Th } from "@/components/ui/Table";
import type { ActionResult } from "@/lib/action-result";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { generarPasswordTemporal } from "@/lib/cuentas/generar-password";
import { filtrarCuentas, type CuentaListItem, type FiltroEstado } from "@/lib/cuentas/listado";
import {
  crearUsuarioAction,
  desactivarCuentaAction,
  purgarCuentaAction,
  reactivarCuentaAction,
  restablecerPasswordAction,
} from "./actions";

const t = copy.usuarios;

type Accion = "restablecer" | "desactivar" | "reactivar" | "purgar";
type DialogState = { kind: "crear" } | { kind: Accion; cuenta: CuentaListItem } | null;
// The temporary password, kept in memory only until the Admin closes it.
type PasswordUnaVez = { email: string; password: string; motivo: "creada" | "restablecida" } | null;

type UsuariosScreenProps = {
  cuentas: CuentaListItem[];
  listaFallo: boolean;
  propiaId: string;
};

export function UsuariosScreen({ cuentas, listaFallo, propiaId }: UsuariosScreenProps) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<FiltroEstado>("activas");
  const [busqueda, setBusqueda] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [passwordUnaVez, setPasswordUnaVez] = useState<PasswordUnaVez>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const visibles = useMemo(() => filtrarCuentas(cuentas, { filtro, busqueda }), [cuentas, filtro, busqueda]);
  const cerrar = () => setDialog(null);

  return (
    <>
      <PageHeader
        kicker={t.kicker}
        title={t.title}
        actions={<Button onClick={() => setDialog({ kind: "crear" })}>{t.nuevoUsuario}</Button>}
      />
      <div className="flex flex-col gap-4 px-[34px] pb-10 pt-[26px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SegmentedFilter
            label={t.filtro.label}
            value={filtro}
            onChange={setFiltro}
            options={[
              { value: "activas", label: t.filtro.activas },
              { value: "todas", label: t.filtro.todas },
            ]}
          />
          <div className="w-full max-w-[320px]">
            <Field
              label={t.busqueda.label}
              type="search"
              placeholder={t.busqueda.placeholder}
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
            />
          </div>
        </div>

        {aviso ? (
          <p role="status" className="text-[12.5px] italic text-ink-soft">
            {aviso}
          </p>
        ) : null}

        {listaFallo ? (
          <Panel>
            <p role="alert" className="text-accent-deep">
              {t.listaFallo}
            </p>
          </Panel>
        ) : visibles.length === 0 ? (
          <Panel>
            <p className="text-ink-soft">{cuentas.length === 0 ? t.vacio : t.sinResultados}</p>
          </Panel>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.columnas.nombre}</Th>
                <Th>{t.columnas.email}</Th>
                <Th>{t.columnas.rol}</Th>
                <Th>{t.columnas.estado}</Th>
                <Th>{t.columnas.acciones}</Th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((cuenta) => {
                const propia = cuenta.id === propiaId;
                const detalle = `/usuarios/${cuenta.id}`;
                return (
                  <tr
                    key={cuenta.id}
                    data-testid="cuenta-row"
                    className={rowClassName(true)}
                    onClick={() => router.push(detalle)}
                  >
                    <Td>
                      {cuenta.nombre ?? <span className="italic text-ink-soft">{t.sinNombre}</span>}
                    </Td>
                    <Td className="text-ink-soft">
                      <Link
                        href={detalle}
                        aria-label={`${t.acciones.verHistorial}: ${cuenta.email}`}
                        className="text-ink no-underline hover:text-accent-deep"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {cuenta.email}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-soft">{copy.auth.roles[cuenta.rol]}</Td>
                    <Td>
                      <div className="flex flex-col items-start gap-1.5">
                        <StatusBadge
                          label={copy.cuentas.estados[cuenta.estado]}
                          tone={cuenta.estado === "activa" ? "active" : "secondary"}
                        />
                        {cuenta.debeCambiarPassword ? (
                          <span className="whitespace-nowrap text-[12.5px] italic text-ink-soft">
                            {t.passwordPendiente}
                          </span>
                        ) : null}
                      </div>
                    </Td>
                    <Td onClick={(event) => event.stopPropagation()}>
                      {propia ? (
                        <span className="whitespace-nowrap text-[12.5px] italic text-ink-soft">{t.tuCuenta}</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {cuenta.estado === "activa" ? (
                            <>
                              <Button variant="secondary" onClick={() => setDialog({ kind: "restablecer", cuenta })}>
                                {t.acciones.restablecer}
                              </Button>
                              <Button variant="secondary" onClick={() => setDialog({ kind: "desactivar", cuenta })}>
                                {t.acciones.desactivar}
                              </Button>
                            </>
                          ) : (
                            <Button variant="secondary" onClick={() => setDialog({ kind: "reactivar", cuenta })}>
                              {t.acciones.reactivar}
                            </Button>
                          )}
                          <Button variant="secondary" onClick={() => setDialog({ kind: "purgar", cuenta })}>
                            {t.acciones.purgar}
                          </Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>

      <CrearUsuarioDialog
        open={dialog?.kind === "crear"}
        onClose={cerrar}
        onCreated={(email, password) => {
          cerrar();
          setAviso(t.exito.creada);
          setPasswordUnaVez({ email, password, motivo: "creada" });
        }}
      />
      {dialog && dialog.kind !== "crear" ? (
        <AccionDialog
          key={`${dialog.kind}-${dialog.cuenta.id}`}
          kind={dialog.kind}
          cuenta={dialog.cuenta}
          onClose={cerrar}
          onDone={(mensaje, password) => {
            cerrar();
            setAviso(mensaje);
            if (password) setPasswordUnaVez({ email: dialog.cuenta.email, password, motivo: "restablecida" });
          }}
        />
      ) : null}
      <PasswordUnaVezDialog value={passwordUnaVez} onClose={() => setPasswordUnaVez(null)} />
    </>
  );
}

// Password input with a "Generar" button. The value never leaves the page
// except in the action call that sets it.
function PasswordTemporalField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            label={t.crear.passwordLabel}
            name="passwordTemporal"
            type="text"
            autoComplete="off"
            spellCheck={false}
            minLength={PASSWORD_MIN_LENGTH}
            required
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
        <Button variant="secondary" onClick={() => onChange(generarPasswordTemporal())}>
          {t.crear.generar}
        </Button>
      </div>
      <p className="text-[12.5px] italic text-ink-soft">{t.crear.passwordHint}</p>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-[12.5px] italic text-accent-deep">
      {error}
    </p>
  ) : null;
}

function CrearUsuarioDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (email: string, password: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<"empleado" | "admin">("empleado");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setEmail("");
    setRol("empleado");
    setPassword("");
    setError(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await crearUsuarioAction({ email, rol, passwordTemporal: password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const created = { email: email.trim(), password };
      reset();
      onCreated(created.email, created.password);
    });
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t.crear.title}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-ink-soft">{t.crear.intro}</p>
        <Field
          label={t.crear.emailLabel}
          name="email"
          type="email"
          autoComplete="off"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Select
          label={t.crear.rolLabel}
          name="rol"
          value={rol}
          onChange={(event) => setRol(event.target.value === "admin" ? "admin" : "empleado")}
          options={[
            { value: "empleado", label: copy.auth.roles.empleado },
            { value: "admin", label: copy.auth.roles.admin },
          ]}
        />
        <PasswordTemporalField value={password} onChange={setPassword} />
        <ErrorLine error={error} />
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {t.acciones.cancelar}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t.crear.submitting : t.crear.submit}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AccionDialog({
  kind,
  cuenta,
  onClose,
  onDone,
}: {
  kind: Accion;
  cuenta: CuentaListItem;
  onClose: () => void;
  onDone: (mensaje: string, password?: string) => void;
}) {
  const [texto, setTexto] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const valores = { email: cuenta.email };

  const config = {
    restablecer: { title: t.restablecer.title, body: t.restablecer.body, confirm: t.restablecer.confirm },
    desactivar: { title: t.desactivar.title, body: t.desactivar.body, confirm: t.desactivar.confirm },
    reactivar: { title: t.reactivar.title, body: t.reactivar.body, confirm: t.reactivar.confirm },
    purgar: { title: t.purgar.title, body: t.purgar.body, confirm: t.purgar.confirm },
  }[kind];

  const listo = kind === "desactivar" ? /\S/.test(texto) : kind === "purgar" ? texto.length > 0 : true;

  function confirmar(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      let result: ActionResult;
      let mensaje: string;
      switch (kind) {
        case "restablecer":
          result = await restablecerPasswordAction({ profileId: cuenta.id, passwordTemporal: password });
          mensaje = t.exito.restablecida;
          break;
        case "desactivar":
          result = await desactivarCuentaAction({ profileId: cuenta.id, motivo: texto });
          mensaje = t.exito.desactivada;
          break;
        case "reactivar":
          result = await reactivarCuentaAction({ profileId: cuenta.id });
          mensaje = t.exito.reactivada;
          break;
        case "purgar":
          result = await purgarCuentaAction({ profileId: cuenta.id, emailConfirmacion: texto });
          mensaje = t.exito.purgada;
          break;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone(mensaje, kind === "restablecer" ? password : undefined);
    });
  }

  return (
    <Dialog open onClose={onClose} title={config.title}>
      <form onSubmit={confirmar} className="flex flex-col gap-4">
        <p className="text-ink-soft">{formatCopy(config.body, valores)}</p>
        {kind === "restablecer" ? <PasswordTemporalField value={password} onChange={setPassword} /> : null}
        {kind === "desactivar" ? (
          <Field
            label={t.desactivar.motivoLabel}
            name="motivo"
            required
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
          />
        ) : null}
        {kind === "purgar" ? (
          <Field
            label={t.purgar.emailLabel}
            name="emailConfirmacion"
            autoComplete="off"
            spellCheck={false}
            required
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
          />
        ) : null}
        <ErrorLine error={error} />
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t.acciones.cancelar}
          </Button>
          <Button type="submit" disabled={pending || !listo}>
            {config.confirm}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// Shows the temporary password once. Closing it discards the value.
function PasswordUnaVezDialog({ value, onClose }: { value: PasswordUnaVez; onClose: () => void }) {
  const [copiada, setCopiada] = useState(false);

  async function copiar() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value.password);
      setCopiada(true);
    } catch {
      // The password stays visible to copy by hand.
    }
  }

  function cerrar() {
    setCopiada(false);
    onClose();
  }

  return (
    <Dialog open={value !== null} onClose={cerrar} title={t.passwordUnaVez.title}>
      {value ? (
        <>
          <p className="text-ink-soft">
            {formatCopy(value.motivo === "creada" ? t.passwordUnaVez.creada : t.passwordUnaVez.restablecida, {
              email: value.email,
            })}
          </p>
          <div className="flex items-center gap-2">
            <output
              data-testid="password-una-vez"
              className="flex-1 select-all break-all rounded-md border border-line px-3 py-[9px] text-[16px] tracking-[.06em] tabular-nums"
            >
              {value.password}
            </output>
            <Button variant="secondary" onClick={copiar}>
              {copiada ? t.passwordUnaVez.copiada : t.passwordUnaVez.copiar}
            </Button>
          </div>
          <p className="text-[12.5px] italic text-accent-deep">{t.passwordUnaVez.note}</p>
          <div className="mt-2 flex justify-end">
            <Button onClick={cerrar}>{t.passwordUnaVez.listo}</Button>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
