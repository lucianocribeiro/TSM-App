"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { cerrarSesionPorInactividad, logout, mantenerSesion } from "@/lib/auth/actions";
import { LOGIN_PATH } from "@/lib/auth/gate";
import { LOGIN_INACTIVIDAD } from "@/lib/auth/guardia";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { formatoRestante, RelojInactividad, SALIDA_KEY, ULTIMA_ACTIVIDAD_KEY, type Almacen, type Fase } from "@/lib/sesion/reloj";
import { anunciarSalida, leerSalida } from "@/lib/sesion/salida";

const t = copy.sesion;

// Real user input. Background requests, timers and focus do not count.
const EVENTOS_ACTIVIDAD = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel", "scroll"] as const;

const almacen: Almacen = {
  leer: (clave) => {
    try {
      return window.localStorage.getItem(clave);
    } catch {
      return null;
    }
  },
  escribir: (clave, valor) => {
    try {
      window.localStorage.setItem(clave, valor);
    } catch {
      // Without storage the limit still works in this tab.
    }
  },
};

function irAlLogin(destino: string) {
  window.location.assign(destino);
}

// The inactivity limit for a signed-in user (PRD session rules): a warning
// with a countdown 2 minutes before, "Seguir conectado" or "Cerrar sesión",
// and the sign-out at 15 minutes. The server enforces the same limit.
export function SesionInactividad() {
  const reloj = useRef<RelojInactividad | null>(null);
  const [fase, setFase] = useState<Fase>({ fase: "activa" });
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const instancia = new RelojInactividad({
      ahora: () => Date.now(),
      almacen,
      alCambiar: setFase,
      alVencer: () => {
        anunciarSalida("inactividad");
        cerrarSesionPorInactividad().catch(() => irAlLogin(LOGIN_INACTIVIDAD));
      },
      alReportar: () => {
        mantenerSesion()
          .then((result) => {
            if (!result.ok) irAlLogin(LOGIN_INACTIVIDAD);
          })
          .catch(() => undefined);
      },
    });
    reloj.current = instancia;
    instancia.iniciar();

    const alActuar = () => instancia.actividad();
    EVENTOS_ACTIVIDAD.forEach((evento) => window.addEventListener(evento, alActuar, { capture: true, passive: true }));

    const alAlmacenar = (event: StorageEvent) => {
      if (event.key === ULTIMA_ACTIVIDAD_KEY) instancia.sincronizar();
      if (event.key === SALIDA_KEY) {
        const motivo = leerSalida(event.newValue);
        if (!motivo) return;
        instancia.detener();
        // End the session from this tab too, rather than only going to the
        // login page: the other tab's sign-out may still be in flight, and
        // the login page sends a live session back in.
        const salida = motivo === "inactividad" ? cerrarSesionPorInactividad() : logout();
        salida
          .then((result) => {
            if (result && !result.ok) irAlLogin(LOGIN_PATH);
          })
          .catch(() => irAlLogin(motivo === "inactividad" ? LOGIN_INACTIVIDAD : LOGIN_PATH));
      }
    };
    window.addEventListener("storage", alAlmacenar);

    return () => {
      instancia.detener();
      EVENTOS_ACTIVIDAD.forEach((evento) => window.removeEventListener(evento, alActuar, { capture: true }));
      window.removeEventListener("storage", alAlmacenar);
      reloj.current = null;
    };
  }, []);

  function cerrar() {
    anunciarSalida("manual");
    startTransition(async () => {
      const result = await logout().catch(() => null);
      if (!result || !result.ok) irAlLogin(LOGIN_PATH);
    });
  }

  return (
    <Dialog open={fase.fase === "aviso"} onClose={() => reloj.current?.continuar()} title={t.avisoTitulo}>
      <p className="text-ink-soft" data-testid="aviso-inactividad">
        {formatCopy(t.avisoCuerpo, { tiempo: fase.fase === "aviso" ? formatoRestante(fase.restanteMs) : "" })}
      </p>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={cerrar} disabled={pending}>
          {t.cerrarSesion}
        </Button>
        <Button onClick={() => reloj.current?.continuar()} disabled={pending}>
          {t.seguirConectado}
        </Button>
      </div>
    </Dialog>
  );
}
