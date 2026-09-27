import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { DOCUMENTO_TIPO_CODES, DOCUMENTOS_BUCKET } from "./tipos";

// Objects in legajo-docs without a legajo_documentos row (an upload whose
// registration failed or was abandoned) must not stay beyond a short window.
// Everything here runs with the caller's own session client, so the storage
// policies apply: a user can only list and remove objects in their own
// folder, and an object in it with no row is removable (orphan rule).

export const UMBRAL_HUERFANO_MINUTOS = 15;
export const UMBRAL_HUERFANO_MS = UMBRAL_HUERFANO_MINUTOS * 60 * 1000;

type Client = SupabaseClient<Database>;

export type ObjetoGuardado = { path: string; creadoEn: string | null };

// Orphans to remove: in the owner's folder, with no document row, and older
// than the threshold. Objects without a creation time are left alone.
export function seleccionarHuerfanos(
  objetos: readonly ObjetoGuardado[],
  registrados: ReadonlySet<string>,
  profileId: string,
  now: Date,
  umbralMs: number = UMBRAL_HUERFANO_MS,
): string[] {
  const limite = now.getTime() - umbralMs;
  return objetos
    .filter((objeto) => objeto.path.startsWith(`${profileId}/`))
    .filter((objeto) => !registrados.has(objeto.path))
    .filter((objeto) => objeto.creadoEn !== null && new Date(objeto.creadoEn).getTime() < limite)
    .map((objeto) => objeto.path);
}

// Removes one object. True when it is gone (a path that no longer exists
// counts as removed), false when Storage reported an error.
export async function eliminarObjeto(client: Client, path: string): Promise<boolean> {
  try {
    const { error } = await client.storage.from(DOCUMENTOS_BUCKET).remove([path]);
    return !error;
  } catch {
    return false;
  }
}

export type BarridoResultado = { ok: true; eliminados: number } | { ok: false };

// The lazy sweep of the caller's own folder: lists <profileId>/<tipo>/ for
// each type, keeps what has a document row (read under RLS), and removes the
// rest once older than the threshold. Never looks at another folder.
export async function barrerHuerfanos(
  client: Client,
  profileId: string,
  { now = new Date(), umbralMs = UMBRAL_HUERFANO_MS }: { now?: Date; umbralMs?: number } = {},
): Promise<BarridoResultado> {
  try {
    const bucket = client.storage.from(DOCUMENTOS_BUCKET);
    const objetos: ObjetoGuardado[] = [];
    for (const tipo of DOCUMENTO_TIPO_CODES) {
      const folder = `${profileId}/${tipo}`;
      const { data, error } = await bucket.list(folder, { limit: 1000 });
      if (error) return { ok: false };
      for (const entry of data ?? []) {
        // Folders have no id.
        if (entry.id !== null) objetos.push({ path: `${folder}/${entry.name}`, creadoEn: entry.created_at ?? null });
      }
    }
    if (objetos.length === 0) return { ok: true, eliminados: 0 };

    const filas = await client
      .from("legajo_documentos")
      .select("storage_path, legajos!inner(profile_id)")
      .eq("legajos.profile_id", profileId);
    if (filas.error) return { ok: false };
    const registrados = new Set((filas.data ?? []).map((fila) => fila.storage_path));

    const huerfanos = seleccionarHuerfanos(objetos, registrados, profileId, now, umbralMs);
    if (huerfanos.length === 0) return { ok: true, eliminados: 0 };
    const { error } = await bucket.remove(huerfanos);
    return error ? { ok: false } : { ok: true, eliminados: huerfanos.length };
  } catch {
    return { ok: false };
  }
}
