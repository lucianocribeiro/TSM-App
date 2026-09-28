"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { contarPendientesCampana } from "./aprobaciones/actions";

// The Admin's pending count for the bell. The layout renders it on every full
// render (and after each decision, which revalidates the layout); a shared
// layout is not rendered again on client navigation, so the count is asked
// again when the path changes. No polling and no realtime. Null (not an
// Admin): nothing is asked.
export function usePendientesAprobacion(inicial: number | null): number | null {
  const pathname = usePathname();
  const [pedido, setPedido] = useState<{ inicial: number; total: number } | null>(null);
  const montado = useRef(false);

  useEffect(() => {
    // The first render already has the layout's count.
    if (!montado.current) {
      montado.current = true;
      return;
    }
    if (inicial === null) return;
    let vigente = true;
    contarPendientesCampana()
      .then((result) => {
        if (vigente && result.ok && result.data) setPedido({ inicial, total: result.data.total });
      })
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [pathname, inicial]);

  if (inicial === null) return null;
  // A newer count from the layout wins over one asked for an older one.
  return pedido && pedido.inicial === inicial ? pedido.total : inicial;
}
