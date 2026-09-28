import Link from "next/link";
import type { ReactNode } from "react";
import { Banner } from "@/components/ui/Banner";
import { buttonClassName } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Empleado } from "@/lib/aprobaciones/bandeja-datos";
import { nombreCompleto } from "@/lib/cuentas/listado";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { formatearFechaHora } from "@/lib/format/fecha";

const t = copy.aprobaciones.detalle;
const bandeja = copy.aprobaciones.bandeja;

// Header and summary shared by the request and document detail pages.
export function DetalleEncabezado({
  empleado,
  titulo,
  enviadoEn,
  propio,
  children,
}: {
  empleado: Empleado;
  titulo: string;
  enviadoEn: string;
  propio: boolean;
  children?: ReactNode;
}) {
  const baja = empleado.estadoCuenta !== "activa";
  return (
    <>
      <PageHeader
        kicker={t.kicker}
        title={nombreCompleto(empleado.nombres, empleado.apellido) ?? bandeja.sinNombre}
        actions={
          <>
            <Link href="/aprobaciones" className={buttonClassName("secondary")}>
              {t.volver}
            </Link>
            <Link href={`/legajos/${empleado.profileId}`} prefetch={false} className={buttonClassName("secondary")}>
              {t.verLegajo}
            </Link>
          </>
        }
      />
      <div className="flex flex-col gap-5 px-[34px] pb-10 pt-[26px]">
        <Panel>
          <h2 className="text-[24px] font-normal leading-[1.1]">{titulo}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-soft tabular-nums">
            <span>{formatCopy(t.enviado, { fecha: formatearFechaHora(enviadoEn) })}</span>
            {empleado.numeroLegajo ? (
              <span>{formatCopy(bandeja.numeroLegajo, { numero: empleado.numeroLegajo })}</span>
            ) : null}
            {baja ? <StatusBadge label={bandeja.dadoDeBaja} tone="secondary" /> : null}
          </div>
        </Panel>
        {baja ? <Banner>{t.cuentaInactiva}</Banner> : null}
        {propio ? (
          <Banner tone="attention">
            <span data-testid="banner-propio">{t.propio}</span>
          </Banner>
        ) : null}
        {children}
      </div>
    </>
  );
}

// Detail pages: the item is gone or no longer pending.
export function DetalleNoDisponible({ mensaje }: { mensaje: string }) {
  return (
    <>
      <PageHeader
        kicker={t.kicker}
        title={bandeja.title}
        actions={
          <Link href="/aprobaciones" className={buttonClassName("secondary")}>
            {t.volver}
          </Link>
        }
      />
      <div className="px-[34px] pb-10 pt-[26px]">
        <Panel>
          <p role="alert" data-testid="detalle-no-disponible" className="text-accent-deep">
            {mensaje}
          </p>
        </Panel>
      </div>
    </>
  );
}
