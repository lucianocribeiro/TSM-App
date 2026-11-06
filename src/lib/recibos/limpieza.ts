import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UMBRAL_HUERFANO_MS } from "@/lib/documentos/limpieza";
import type { Database } from "@/lib/supabase/database.types";
import { FIRMAS_BUCKET, RECIBOS_BUCKET } from "./tipos";

// Orphan sweep for the recibos and firmas buckets (F2-03), the legajo
// documents approach: an object older than 15 minutes that no row
// references is removed. Referenced objects are never removed:
//   recibos: recibos.archivo_path, recibo_historial.archivo_path,
//            recibo_overrides.archivo_path
//   firmas:  firmas_empleado.imagen_path
//
// Admin only. Neither bucket has a delete policy, so the caller (an Admin
// Server Action or a system job, after its own checks) passes the privileged
// client it is allowed to hold; this module never imports it. If a listing
// or reference read of a bucket fails, nothing more is removed and the result
// is not ok. If a removal fails, the result is not ok and lists the paths
// that are still there.

type Client = SupabaseClient<Database>;

class LecturaFallida extends Error {}

export type ObjetoGuardado = { path: string; creadoEn: string | null };

export type BarridoRecibosResultado =
  | { ok: true; eliminados: number }
  | { ok: false; eliminados: number; fallidos: string[] };

// One reader per referencing column: the paths of the batch that a row holds.
type Lector = (client: Client, lote: string[]) => PromiseLike<string[]>;

function leer<T>(columna: keyof T & string) {
  return async ({ data, error }: { data: T[] | null; error: unknown }): Promise<string[]> => {
    if (error) throw new LecturaFallida();
    return (data ?? []).map((fila) => String(fila[columna]));
  };
}

const REFERENCIAS: Record<string, readonly Lector[]> = {
  [RECIBOS_BUCKET]: [
    (c, lote) => c.from("recibos").select("archivo_path").in("archivo_path", lote).then(leer("archivo_path")),
    (c, lote) => c.from("recibo_historial").select("archivo_path").in("archivo_path", lote).then(leer("archivo_path")),
    (c, lote) => c.from("recibo_overrides").select("archivo_path").in("archivo_path", lote).then(leer("archivo_path")),
  ],
  [FIRMAS_BUCKET]: [
    (c, lote) => c.from("firmas_empleado").select("imagen_path").in("imagen_path", lote).then(leer("imagen_path")),
  ],
};

const PAGINA = 1000;
// Paths per reference query (keeps the URL of the "in" filter short).
const LOTE = 100;

// Old enough and not referenced. Objects without a creation time are left alone.
export function seleccionarHuerfanos(
  objetos: readonly ObjetoGuardado[],
  referenciados: ReadonlySet<string>,
  now: Date,
  umbralMs: number = UMBRAL_HUERFANO_MS,
): string[] {
  const limite = now.getTime() - umbralMs;
  return objetos
    .filter((objeto) => !referenciados.has(objeto.path))
    .filter((objeto) => objeto.creadoEn !== null && new Date(objeto.creadoEn).getTime() < limite)
    .map((objeto) => objeto.path);
}

// Every object of the bucket, walking folders (entries without an id).
async function listarTodo(client: Client, bucket: string, carpeta = ""): Promise<ObjetoGuardado[]> {
  const objetos: ObjetoGuardado[] = [];
  for (let offset = 0; ; offset += PAGINA) {
    const { data, error } = await client.storage.from(bucket).list(carpeta, { limit: PAGINA, offset });
    if (error) throw new LecturaFallida();
    for (const entrada of data ?? []) {
      const path = carpeta ? `${carpeta}/${entrada.name}` : entrada.name;
      if (entrada.id === null) objetos.push(...(await listarTodo(client, bucket, path)));
      else objetos.push({ path, creadoEn: entrada.created_at ?? null });
    }
    if ((data ?? []).length < PAGINA) return objetos;
  }
}

async function referenciados(client: Client, bucket: string, paths: readonly string[]): Promise<Set<string>> {
  const encontrados = new Set<string>();
  for (const lector of REFERENCIAS[bucket] ?? []) {
    for (let i = 0; i < paths.length; i += LOTE) {
      for (const path of await lector(client, paths.slice(i, i + LOTE))) encontrados.add(path);
    }
  }
  return encontrados;
}

async function eliminar(client: Client, bucket: string, path: string): Promise<boolean> {
  try {
    const { data, error } = await client.storage.from(bucket).remove([path]);
    // Storage answers a removal it did not do with no objects.
    return !error && (data ?? []).length > 0;
  } catch {
    return false;
  }
}

async function barrerBucket(
  client: Client,
  bucket: string,
  now: Date,
  umbralMs: number,
): Promise<{ eliminados: number; fallidos: string[] }> {
  const objetos = await listarTodo(client, bucket);
  const candidatos = seleccionarHuerfanos(objetos, new Set(), now, umbralMs);
  if (candidatos.length === 0) return { eliminados: 0, fallidos: [] };
  const conFila = await referenciados(client, bucket, candidatos);
  let eliminados = 0;
  const fallidos: string[] = [];
  for (const path of candidatos.filter((candidato) => !conFila.has(candidato))) {
    if (await eliminar(client, bucket, path)) eliminados++;
    else fallidos.push(path);
  }
  return { eliminados, fallidos };
}

export async function barrerHuerfanosRecibos(
  client: Client,
  { now = new Date(), umbralMs = UMBRAL_HUERFANO_MS }: { now?: Date; umbralMs?: number } = {},
): Promise<BarridoRecibosResultado> {
  let eliminados = 0;
  const fallidos: string[] = [];
  for (const bucket of [RECIBOS_BUCKET, FIRMAS_BUCKET]) {
    try {
      const resultado = await barrerBucket(client, bucket, now, umbralMs);
      eliminados += resultado.eliminados;
      fallidos.push(...resultado.fallidos);
    } catch {
      // A failed listing or reference read: this bucket is left untouched.
      return { ok: false, eliminados, fallidos };
    }
  }
  return fallidos.length === 0 ? { ok: true, eliminados } : { ok: false, eliminados, fallidos };
}
