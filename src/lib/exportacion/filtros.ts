import { z } from "zod";
import type { FiltrosLegajos } from "@/lib/legajo/listado";
import { ESTADOS_LABORALES } from "@/lib/legajo/options";

// The Legajos list state an export runs with (CR-4): exactly the list's
// filters, search and "Mostrar dados de baja", nothing else. The server runs
// the list query again with them; rows never come from the client.

const MAX_BUSQUEDA = 200;
const id = z.union([z.literal(""), z.uuid()]);

const esquema = z
  .object({
    busqueda: z.string().max(MAX_BUSQUEDA),
    estadoLaboral: z.union([z.literal(""), z.enum(ESTADOS_LABORALES)]),
    areaId: id,
    sucursalId: id,
    tareaId: id,
    mostrarBajas: z.boolean(),
  })
  .strict();

// null when the state is not exactly the list's (unknown keys, bad types or
// ids, an over-long search).
export function validarFiltros(input: unknown): FiltrosLegajos | null {
  const parsed = esquema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
