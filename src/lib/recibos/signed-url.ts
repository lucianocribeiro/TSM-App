import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/documentos/signed-url";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { parseFirmaPath, parseReciboPath } from "./paths";
import { FIRMAS_BUCKET, RECIBOS_BUCKET } from "./tipos";

// Signed URLs for receipts and signatures (F2-03).
//
// Authorization is the caller's job: the Server Actions of F2-04 and F2-05
// check the session, role, account state and ownership before calling any
// of these. None of them is called by a route yet.
//
// - Download links (5 minutes, the legajo documents TTL) use the
//   session-bound client, so the storage SELECT policies decide access: an
//   Empleado gets a link only for a file a visible row references.
// - Upload links: neither bucket has a write policy for authenticated, so the
//   caller passes the privileged client it is allowed to hold, after its own
//   checks. This module never imports the service-role client. Storage fixes
//   the lifetime of a signed upload URL (it has no TTL option); upsert is off,
//   so an existing object is never overwritten.

export type UrlFirmada = { ok: true; url: string } | { ok: false };
export type UrlSubida = { ok: true; path: string; token: string; url: string } | { ok: false };

type Client = SupabaseClient<Database>;

async function urlDescarga(bucket: string, path: string, download: string | undefined): Promise<UrlFirmada> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, download ? { download } : undefined);
    if (error || !data?.signedUrl) return { ok: false };
    return { ok: true, url: data.signedUrl };
  } catch {
    return { ok: false };
  }
}

async function urlSubida(client: Client, bucket: string, path: string): Promise<UrlSubida> {
  try {
    const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path, { upsert: false });
    if (error || !data?.signedUrl || !data.token) return { ok: false };
    return { ok: true, path: data.path, token: data.token, url: data.signedUrl };
  } catch {
    return { ok: false };
  }
}

// With `download`, the link serves the file as an attachment with that name.
export async function crearUrlFirmadaRecibo(path: string, options: { download?: string } = {}): Promise<UrlFirmada> {
  if (!parseReciboPath(path)) return { ok: false };
  return urlDescarga(RECIBOS_BUCKET, path, options.download);
}

export async function crearUrlFirmadaFirma(path: string): Promise<UrlFirmada> {
  if (!parseFirmaPath(path)) return { ok: false };
  return urlDescarga(FIRMAS_BUCKET, path, undefined);
}

export async function crearUrlSubidaRecibo(client: Client, path: string): Promise<UrlSubida> {
  if (!parseReciboPath(path)) return { ok: false };
  return urlSubida(client, RECIBOS_BUCKET, path);
}

export async function crearUrlSubidaFirma(client: Client, path: string): Promise<UrlSubida> {
  if (!parseFirmaPath(path)) return { ok: false };
  return urlSubida(client, FIRMAS_BUCKET, path);
}
