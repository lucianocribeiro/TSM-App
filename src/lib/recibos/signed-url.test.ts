import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// The session client double records which bucket, path and TTL it is asked
// for; the privileged client double, the upload requests.
const llamadas = vi.hoisted(() => ({ descarga: [] as unknown[][], subida: [] as unknown[][] }));
const fallar = vi.hoisted(() => ({ si: false }));

function clienteDoble(): unknown {
  return {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number, options?: unknown) => {
          llamadas.descarga.push([bucket, path, ttl, options]);
          return fallar.si ? { data: null, error: new Error("x") } : { data: { signedUrl: `https://s/${path}` }, error: null };
        },
        createSignedUploadUrl: async (path: string, options?: unknown) => {
          llamadas.subida.push([bucket, path, options]);
          return fallar.si
            ? { data: null, error: new Error("x") }
            : { data: { signedUrl: `https://u/${path}`, token: "t", path }, error: null };
        },
      }),
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => clienteDoble() }));

const { crearUrlFirmadaFirma, crearUrlFirmadaRecibo, crearUrlSubidaFirma, crearUrlSubidaRecibo } = await import("./signed-url");
const { SIGNED_URL_TTL_SECONDS } = await import("@/lib/documentos/signed-url");

const EMP = "11111111-1111-4111-8111-111111111111";
const PER = "22222222-2222-4222-8222-222222222222";
const ARCH = "33333333-3333-4333-8333-333333333333";
const RECIBO = `${EMP}/${PER}/${ARCH}.pdf`;
const FIRMA = `${EMP}/1-${ARCH}.png`;
const privilegiado = clienteDoble() as SupabaseClient<Database>;

beforeEach(() => {
  llamadas.descarga = [];
  llamadas.subida = [];
  fallar.si = false;
});

describe("download links", () => {
  it("last 300 seconds, the legajo documents TTL", async () => {
    expect(SIGNED_URL_TTL_SECONDS).toBe(300);
    expect(await crearUrlFirmadaRecibo(RECIBO)).toEqual({ ok: true, url: `https://s/${RECIBO}` });
    expect(await crearUrlFirmadaRecibo(RECIBO, { download: "recibo.pdf" })).toMatchObject({ ok: true });
    expect(await crearUrlFirmadaFirma(FIRMA)).toEqual({ ok: true, url: `https://s/${FIRMA}` });
    expect(llamadas.descarga).toEqual([
      ["recibos", RECIBO, 300, undefined],
      ["recibos", RECIBO, 300, { download: "recibo.pdf" }],
      ["firmas", FIRMA, 300, undefined],
    ]);
  });

  it("refuse a path of the wrong layout without asking Storage", async () => {
    expect(await crearUrlFirmadaRecibo(FIRMA)).toEqual({ ok: false });
    expect(await crearUrlFirmadaFirma(RECIBO)).toEqual({ ok: false });
    expect(await crearUrlFirmadaRecibo(`${EMP}/../${ARCH}.pdf`)).toEqual({ ok: false });
    expect(llamadas.descarga).toEqual([]);
  });

  it("report a Storage refusal as not ok", async () => {
    fallar.si = true;
    expect(await crearUrlFirmadaRecibo(RECIBO)).toEqual({ ok: false });
  });
});

describe("upload links", () => {
  it("use the client the caller passes, without overwriting", async () => {
    expect(await crearUrlSubidaRecibo(privilegiado, RECIBO)).toEqual({ ok: true, path: RECIBO, token: "t", url: `https://u/${RECIBO}` });
    expect(await crearUrlSubidaFirma(privilegiado, FIRMA)).toMatchObject({ ok: true, path: FIRMA });
    expect(llamadas.subida).toEqual([
      ["recibos", RECIBO, { upsert: false }],
      ["firmas", FIRMA, { upsert: false }],
    ]);
  });

  it("refuse a path of the wrong layout, and report a Storage refusal", async () => {
    expect(await crearUrlSubidaRecibo(privilegiado, FIRMA)).toEqual({ ok: false });
    expect(await crearUrlSubidaFirma(privilegiado, RECIBO)).toEqual({ ok: false });
    expect(llamadas.subida).toEqual([]);
    fallar.si = true;
    expect(await crearUrlSubidaRecibo(privilegiado, RECIBO)).toEqual({ ok: false });
  });
});
