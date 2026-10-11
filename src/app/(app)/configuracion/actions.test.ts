import { beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";

// The /configuracion actions with the database replaced by a fake session
// client: the Admin check before anything else, the input shape, the shared
// name validator before any write, the version check, and the mapping of
// database refusals to es-AR messages. Behaviour against the real database:
// tests/integration/configuracion.test.ts.

const ID = "11111111-1111-4111-8111-111111111111";
const AREA = "22222222-2222-4222-8222-222222222222";

type Result = { data?: unknown; error?: unknown };

const mocks = vi.hoisted(() => ({
  sessionWithRole: vi.fn(),
  revalidatePath: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  queries: [] as { table: string; ops: [string, unknown[]][] }[],
  resolve: (() => ({ data: [], error: null })) as (table: string, ops: [string, unknown[]][]) => Result,
}));

// A query builder double: every call is recorded and chains; awaiting it
// resolves through mocks.resolve.
function query(table: string) {
  const ops: [string, unknown[]][] = [];
  mocks.queries.push({ table, ops });
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") {
          return (onFulfilled: (value: Result) => unknown, onRejected: (reason: unknown) => unknown) =>
            Promise.resolve(mocks.resolve(table, ops)).then(onFulfilled, onRejected);
        }
        return (...args: unknown[]) => {
          ops.push([prop, args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/lib/auth/require-role", () => ({ sessionWithRole: mocks.sessionWithRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

const actions = await import("./actions");
const errors = copy.configuracion.errors;
const fallo = (error: string) => ({ ok: false, error });
const tiene = (ops: [string, unknown[]][], op: string) => ops.some(([nombre]) => nombre === op);
const escrituras = () => mocks.queries.filter((q) => q.ops.some(([op]) => op === "insert" || op === "update" || op === "delete"));

beforeEach(() => {
  mocks.sessionWithRole.mockReset().mockResolvedValue({ id: "admin-1", role: "admin" });
  mocks.revalidatePath.mockReset();
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.createClient.mockReset().mockResolvedValue({ from: (table: string) => query(table), rpc: mocks.rpc });
  mocks.queries.length = 0;
  mocks.resolve = () => ({ data: [], error: null });
});

const CASOS = [
  ["agregarItem", actions.agregarItem, { lista: "sucursal", nombre: "Tigre" }],
  ["renombrarItem", actions.renombrarItem, { id: ID, version: 1, nombre: "Tigre" }],
  ["desactivarItem", actions.desactivarItem, { id: ID, version: 1 }],
  ["reactivarItem", actions.reactivarItem, { id: ID, version: 1 }],
  ["moverItem", actions.moverItem, { id: ID, version: 1, direccion: "arriba" }],
  ["eliminarItem", actions.eliminarItem, { id: ID, version: 1 }],
] as const;

describe.each(CASOS)("%s", (_nombre, action, input) => {
  it("refuses a caller who is not an active Admin before anything else", async () => {
    mocks.sessionWithRole.mockResolvedValue(null);
    await expect(action(input)).resolves.toEqual(fallo(copy.cuentas.errors.noAutorizado));
    expect(mocks.sessionWithRole).toHaveBeenCalledWith("admin");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an input with the wrong shape without touching the database", async () => {
    const malos: unknown[] = [null, "texto", {}];
    if ("id" in input) malos.push({ ...input, id: "no-es-uuid" });
    if ("version" in input) malos.push({ ...input, version: 0 }, { ...input, version: "1" });
    if ("lista" in input) malos.push({ ...input, lista: "otra" });
    if ("nombre" in input) malos.push({ ...input, nombre: 3 });
    if ("direccion" in input) malos.push({ ...input, direccion: "costado" });
    for (const malo of malos) {
      await expect(action(malo), JSON.stringify(malo)).resolves.toEqual(fallo(errors.accionFallo));
    }
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("agregarItem", () => {
  it("validates the name against its list before writing, and stores it normalized", async () => {
    mocks.resolve = (_table, ops) => (tiene(ops, "insert") ? { data: null, error: null } : { data: [{ id: ID, nombre: "Casa Central" }], error: null });
    await expect(actions.agregarItem({ lista: "sucursal", nombre: " CASA  central " })).resolves.toEqual(fallo(errors.nombreDuplicado));
    await expect(actions.agregarItem({ lista: "sucursal", nombre: "   " })).resolves.toEqual(fallo(errors.nombreVacio));
    expect(escrituras()).toEqual([]);

    await expect(actions.agregarItem({ lista: "sucursal", nombre: "  San   Isidro " })).resolves.toEqual({ ok: true });
    const [alta] = escrituras();
    expect(alta.ops.find(([op]) => op === "insert")?.[1][0]).toEqual({ lista: "sucursal", area_id: null, nombre: "San Isidro" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/configuracion", "layout");
  });

  it("a Puesto needs an existing Área; other lists take none", async () => {
    await expect(actions.agregarItem({ lista: "puesto", nombre: "Cajero" })).resolves.toEqual(fallo(errors.areaInvalida));
    await expect(actions.agregarItem({ lista: "tarea", areaId: AREA, nombre: "Cajero" })).resolves.toEqual(fallo(errors.accionFallo));
    mocks.resolve = (_table, ops) => (tiene(ops, "maybeSingle") ? { data: null, error: null } : { data: [], error: null });
    await expect(actions.agregarItem({ lista: "puesto", areaId: AREA, nombre: "Cajero" })).resolves.toEqual(fallo(errors.areaInvalida));
    expect(escrituras()).toEqual([]);
  });

  it("maps a uniqueness conflict from the database to the duplicate message", async () => {
    mocks.resolve = (_table, ops) => (tiene(ops, "insert") ? { data: null, error: { code: "23505" } } : { data: [], error: null });
    await expect(actions.agregarItem({ lista: "convenio", nombre: "Comercio" })).resolves.toEqual(fallo(errors.nombreDuplicado));
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("renombrarItem", () => {
  const actual = { id: ID, lista: "puesto", area_id: AREA, nombre: "Cobranzas", version: 3 };

  it("refuses a stale version or a missing item before writing", async () => {
    mocks.resolve = (_table, ops) => (tiene(ops, "maybeSingle") ? { data: actual, error: null } : { data: [], error: null });
    await expect(actions.renombrarItem({ id: ID, version: 2, nombre: "Pagos" })).resolves.toEqual(fallo(errors.cambioConcurrente));
    mocks.resolve = () => ({ data: null, error: null });
    await expect(actions.renombrarItem({ id: ID, version: 3, nombre: "Pagos" })).resolves.toEqual(fallo(errors.noEncontrado));
    expect(escrituras()).toEqual([]);
  });

  it("checks duplicates within the Área, without the item itself; an unchanged name writes nothing", async () => {
    mocks.resolve = (_table, ops) =>
      tiene(ops, "maybeSingle")
        ? { data: actual, error: null }
        : { data: [{ id: ID, nombre: "Cobranzas" }, { id: AREA, nombre: "Proveedores" }], error: null };
    await expect(actions.renombrarItem({ id: ID, version: 3, nombre: "proveedores" })).resolves.toEqual(fallo(errors.nombreDuplicadoPuesto));
    await expect(actions.renombrarItem({ id: ID, version: 3, nombre: " Cobranzas " })).resolves.toEqual({ ok: true });
    expect(escrituras()).toEqual([]);
  });

  it("writes with the version it checked; no row matched means a concurrent change", async () => {
    let lecturas = 0;
    mocks.resolve = (_table, ops) => {
      if (tiene(ops, "update")) return { data: [], error: null };
      if (tiene(ops, "maybeSingle")) return { data: lecturas++ === 0 ? actual : { id: ID }, error: null };
      return { data: [], error: null };
    };
    await expect(actions.renombrarItem({ id: ID, version: 3, nombre: "Pagos" })).resolves.toEqual(fallo(errors.cambioConcurrente));
    const [cambio] = escrituras();
    expect(cambio.ops).toContainEqual(["update", [{ nombre: "Pagos" }]]);
    expect(cambio.ops).toContainEqual(["eq", ["version", 3]]);
  });
});

describe("desactivarItem, reactivarItem and eliminarItem", () => {
  it("send the state with the version", async () => {
    mocks.resolve = () => ({ data: [{ id: ID }], error: null });
    await expect(actions.desactivarItem({ id: ID, version: 4 })).resolves.toEqual({ ok: true });
    await expect(actions.reactivarItem({ id: ID, version: 5 })).resolves.toEqual({ ok: true });
    const [baja, alta] = escrituras();
    expect(baja.ops).toContainEqual(["update", [{ activo: false }]]);
    expect(baja.ops).toContainEqual(["eq", ["version", 4]]);
    expect(alta.ops).toContainEqual(["update", [{ activo: true }]]);
  });

  it("an item in use cannot be deleted; a gone item is reported as such", async () => {
    mocks.resolve = (_table, ops) => (tiene(ops, "delete") ? { data: null, error: { code: "23503", message: "fk detail" } } : { data: null, error: null });
    await expect(actions.eliminarItem({ id: ID, version: 1 })).resolves.toEqual(fallo(errors.enUso));
    mocks.resolve = (_table, ops) => (tiene(ops, "delete") ? { data: [], error: null } : { data: null, error: null });
    await expect(actions.eliminarItem({ id: ID, version: 1 })).resolves.toEqual(fallo(errors.noEncontrado));
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("moverItem", () => {
  it("calls the database swap and maps its refusals", async () => {
    await expect(actions.moverItem({ id: ID, version: 2, direccion: "abajo" })).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("mover_catalogo_item", { p_item_id: ID, p_version: 2, p_direccion: "abajo" });
    for (const [error, mensaje] of [
      [{ code: "55000", hint: "version" }, errors.cambioConcurrente],
      [{ code: "55000", hint: "extremo" }, errors.extremo],
      [{ code: "P0002" }, errors.noEncontrado],
      [{ code: "42501", message: "Only an admin can reorder lists" }, errors.accionFallo],
    ] as const) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error });
      await expect(actions.moverItem({ id: ID, version: 2, direccion: "arriba" })).resolves.toEqual(fallo(mensaje));
    }
  });
});
