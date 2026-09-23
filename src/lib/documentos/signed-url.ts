import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { copy } from "@/lib/copy/es-AR";
import { createClient } from "@/lib/supabase/server";
import { parseDocumentoPath } from "./paths";
import { DOCUMENTOS_BUCKET } from "./tipos";

// Short-lived download links for legajo documents. Uses the session-bound
// server client so the storage policies decide access. Never use the
// service-role client here: it would bypass RLS.

export const SIGNED_URL_TTL_SECONDS = 5 * 60;

export async function createDocumentoSignedUrl(
  storagePath: string,
): Promise<ActionResult<{ url: string }>> {
  if (!parseDocumentoPath(storagePath)) {
    return { ok: false, error: copy.documentos.errors.downloadFailed };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(DOCUMENTOS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return { ok: false, error: copy.documentos.errors.downloadFailed };
  }
  return { ok: true, data: { url: data.signedUrl } };
}
