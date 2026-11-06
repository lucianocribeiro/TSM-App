import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

vi.mock("server-only", () => ({}));
const { barrerHuerfanosRecibos, seleccionarHuerfanos } = await import("./limpieza");

const EMP = "11111111-1111-4111-8111-111111111111";
const PER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-06T12:00:00Z");
const hace = (minutos: number) => new Date(NOW.getTime() - minutos * 60_000).toISOString();

type Entrada = { name: string; id: string | null; created_at: string | null };

// A privileged client double: bucket listings per folder, the referenced
// paths per table, and removals (some can be made to fail). Records removals.
function clienteDoble({
  carpetas,
  filas = {},
  fallaRemover = [],
  fallaLectura = false,
}: {
  carpetas: Record<string, Record<string, Entrada[]>>;
  filas?: Partial<Record<"recibos" | "recibo_historial" | "recibo_overrides" | "firmas_empleado", string[]>>;
  fallaRemover?: string[];
  fallaLectura?: boolean;
}) {
  const removidos: string[] = [];
  const cliente = {
    storage: {
      from: (bucket: string) => ({
        list: async (carpeta: string) => ({ data: carpetas[bucket]?.[carpeta] ?? [], error: null }),
        remove: async ([path]: string[]) => {
          if (fallaRemover.includes(path)) return { data: [], error: null };
          removidos.push(`${bucket}:${path}`);
          return { data: [{ name: path }], error: null };
        },
      }),
    },
    from: (tabla: keyof typeof filas) => ({
      select: (columna: string) => ({
        in: (_columna: string, lote: string[]) => ({
          then: (resolver: (r: { data: Record<string, string>[] | null; error: unknown }) => unknown) =>
            Promise.resolve(
              fallaLectura
                ? { data: null, error: new Error("x") }
                : { data: (filas[tabla] ?? []).filter((p) => lote.includes(p)).map((p) => ({ [columna]: p })), error: null },
            ).then(resolver),
        }),
      }),
    }),
  };
  return { cliente: cliente as unknown as SupabaseClient<Database>, removidos };
}

const archivo = (name: string, minutos: number | null): Entrada => ({ name, id: name, created_at: minutos === null ? null : hace(minutos) });
const carpeta = (name: string): Entrada => ({ name, id: null, created_at: null });

// recibos: EMP/PER/<file>, firmas: EMP/<file>.
const carpetas = (recibos: Entrada[], firmas: Entrada[]) => ({
  recibos: { "": [carpeta(EMP)], [EMP]: [carpeta(PER)], [`${EMP}/${PER}`]: recibos },
  firmas: { "": [carpeta(EMP)], [EMP]: firmas },
});

describe("seleccionarHuerfanos", () => {
  it("picks unreferenced objects older than 15 minutes only", () => {
    const objetos = [
      { path: "a", creadoEn: hace(60) },
      { path: "b", creadoEn: hace(16) },
      { path: "c", creadoEn: hace(14) },
      { path: "d", creadoEn: null },
    ];
    expect(seleccionarHuerfanos(objetos, new Set(["a"]), NOW)).toEqual(["b"]);
  });
});

describe("barrerHuerfanosRecibos", () => {
  it("keeps every referenced object, whatever its age and table", async () => {
    const r = `${EMP}/${PER}`;
    const { cliente, removidos } = clienteDoble({
      carpetas: carpetas([archivo("actual.pdf", 60), archivo("historial.pdf", 60), archivo("override.pdf", 60)], [archivo("1-f.png", 60)]),
      filas: {
        recibos: [`${r}/actual.pdf`],
        recibo_historial: [`${r}/historial.pdf`],
        recibo_overrides: [`${r}/override.pdf`],
        firmas_empleado: [`${EMP}/1-f.png`],
      },
    });
    expect(await barrerHuerfanosRecibos(cliente, { now: NOW })).toEqual({ ok: true, eliminados: 0 });
    expect(removidos).toEqual([]);
  });

  it("keeps unreferenced objects younger than 15 minutes, and removes older ones in both buckets", async () => {
    const { cliente, removidos } = clienteDoble({
      carpetas: carpetas([archivo("nuevo.pdf", 14), archivo("viejo.pdf", 16), archivo("sin-fecha.pdf", null)], [archivo("1-nueva.png", 5), archivo("2-vieja.png", 30)]),
    });
    expect(await barrerHuerfanosRecibos(cliente, { now: NOW })).toEqual({ ok: true, eliminados: 2 });
    expect(removidos).toEqual([`recibos:${EMP}/${PER}/viejo.pdf`, `firmas:${EMP}/2-vieja.png`]);
  });

  it("reports partial failure when one removal fails, with the paths left", async () => {
    const queda = `${EMP}/${PER}/b.pdf`;
    const { cliente, removidos } = clienteDoble({
      carpetas: carpetas([archivo("a.pdf", 60), archivo("b.pdf", 60)], [archivo("1-x.png", 60)]),
      fallaRemover: [queda],
    });
    expect(await barrerHuerfanosRecibos(cliente, { now: NOW })).toEqual({ ok: false, eliminados: 2, fallidos: [queda] });
    expect(removidos).toEqual([`recibos:${EMP}/${PER}/a.pdf`, `firmas:${EMP}/1-x.png`]);
  });

  it("removes nothing when the references cannot be read", async () => {
    const { cliente, removidos } = clienteDoble({
      carpetas: carpetas([archivo("a.pdf", 60)], []),
      fallaLectura: true,
    });
    expect(await barrerHuerfanosRecibos(cliente, { now: NOW })).toEqual({ ok: false, eliminados: 0, fallidos: [] });
    expect(removidos).toEqual([]);
  });
});
