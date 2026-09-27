import { describe, expect, it, vi } from "vitest";
import { barrerHuerfanos, seleccionarHuerfanos, UMBRAL_HUERFANO_MINUTOS, UMBRAL_HUERFANO_MS } from "./limpieza";

const UID = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-27T12:00:00Z");
const hace = (minutos: number) => new Date(NOW.getTime() - minutos * 60_000).toISOString();

describe("the threshold", () => {
  it("is 15 minutes", () => {
    expect(UMBRAL_HUERFANO_MINUTOS).toBe(15);
    expect(UMBRAL_HUERFANO_MS).toBe(15 * 60_000);
  });
});

describe("seleccionarHuerfanos", () => {
  const registrado = `${UID}/dni_frente/a.pdf`;
  const objetos = [
    { path: registrado, creadoEn: hace(60) },
    { path: `${UID}/dni_frente/viejo.pdf`, creadoEn: hace(16) },
    { path: `${UID}/dni_dorso/reciente.pdf`, creadoEn: hace(14) },
    { path: `${UID}/dni_dorso/sin-fecha.pdf`, creadoEn: null },
    { path: `${OTRO}/dni_frente/ajeno.pdf`, creadoEn: hace(60) },
  ];

  it("picks only rowless objects older than the threshold, in the owner's folder", () => {
    expect(seleccionarHuerfanos(objetos, new Set([registrado]), UID, NOW)).toEqual([`${UID}/dni_frente/viejo.pdf`]);
  });

  it("never picks another folder's objects, whatever their age", () => {
    expect(seleccionarHuerfanos(objetos, new Set(), OTRO, NOW)).toEqual([`${OTRO}/dni_frente/ajeno.pdf`]);
    expect(seleccionarHuerfanos(objetos, new Set(), UID, NOW)).not.toContain(`${OTRO}/dni_frente/ajeno.pdf`);
  });
});

// A session client double: storage listing per folder, the caller's document
// rows, and removal. Records what it is asked for.
function fakeClient({
  folders = {} as Record<string, { name: string; id: string | null; created_at: string | null }[]>,
  rows = [] as string[],
  listError = false,
  removeError = false,
}) {
  const list = vi.fn(async (folder: string) =>
    listError ? { data: null, error: { message: "boom" } } : { data: folders[folder] ?? [], error: null },
  );
  const remove = vi.fn(async (paths: string[]) => (removeError ? { data: null, error: { message: "x" } } : { data: paths, error: null }));
  const eq = vi.fn(async () => ({ data: rows.map((storage_path) => ({ storage_path })), error: null }));
  const client = {
    storage: { from: () => ({ list, remove }) },
    from: () => ({ select: () => ({ eq }) }),
  };
  return { client: client as never, list, remove, eq };
}

describe("barrerHuerfanos", () => {
  it("lists only the caller's own type folders and removes only old rowless objects", async () => {
    const fake = fakeClient({
      folders: {
        [`${UID}/dni_frente`]: [
          { name: "registrado.pdf", id: "1", created_at: hace(60) },
          { name: "viejo.pdf", id: "2", created_at: hace(30) },
        ],
        [`${UID}/dni_dorso`]: [{ name: "reciente.pdf", id: "3", created_at: hace(5) }],
        [`${UID}/licencia_conducir`]: [{ name: "carpeta", id: null, created_at: null }],
      },
      rows: [`${UID}/dni_frente/registrado.pdf`],
    });
    await expect(barrerHuerfanos(fake.client, UID, { now: NOW })).resolves.toEqual({ ok: true, eliminados: 1 });
    expect(fake.list.mock.calls.map(([folder]) => folder)).toEqual([
      `${UID}/dni_frente`,
      `${UID}/dni_dorso`,
      `${UID}/licencia_conducir`,
    ]);
    expect(fake.eq).toHaveBeenCalledWith("legajos.profile_id", UID);
    expect(fake.remove).toHaveBeenCalledTimes(1);
    expect(fake.remove).toHaveBeenCalledWith([`${UID}/dni_frente/viejo.pdf`]);
  });

  it("removes nothing when everything is fresh or registered", async () => {
    const fake = fakeClient({
      folders: { [`${UID}/dni_frente`]: [{ name: "fresco.pdf", id: "1", created_at: hace(1) }] },
    });
    await expect(barrerHuerfanos(fake.client, UID, { now: NOW })).resolves.toEqual({ ok: true, eliminados: 0 });
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it("reports a failure instead of throwing", async () => {
    await expect(barrerHuerfanos(fakeClient({ listError: true }).client, UID, { now: NOW })).resolves.toEqual({ ok: false });
    const removeFails = fakeClient({
      folders: { [`${UID}/dni_frente`]: [{ name: "viejo.pdf", id: "1", created_at: hace(60) }] },
      removeError: true,
    });
    await expect(barrerHuerfanos(removeFails.client, UID, { now: NOW })).resolves.toEqual({ ok: false });
  });
});
