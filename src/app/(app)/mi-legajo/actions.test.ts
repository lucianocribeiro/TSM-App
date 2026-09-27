import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";

// Failure paths of the document actions (AUD08-02), with Storage and the
// database replaced by a fake session client. Every failure after an upload
// must remove the object and check that the removal worked.

const UID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";
const PATH = `${UID}/dni_frente/${FILE_ID}.pdf`;

type Result = { data?: unknown; error?: unknown; count?: number | null };

const state = vi.hoisted(() => ({
  list: null as unknown as ReturnType<typeof vi.fn>,
  remove: null as unknown as ReturnType<typeof vi.fn>,
  // Answers a query: table name plus the chain of calls made on it.
  resolve: null as unknown as (table: string, ops: string[]) => Result,
}));

// A query builder double: every call is recorded and chains; awaiting it
// resolves through state.resolve.
function query(table: string) {
  const ops: string[] = [];
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") {
          return (onFulfilled: (value: Result) => unknown, onRejected: (reason: unknown) => unknown) =>
            Promise.resolve(state.resolve(table, ops)).then(onFulfilled, onRejected);
        }
        return () => {
          ops.push(prop);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => ({ id: UID, email: "a@mitsm.test", role: "empleado", cuenta: { estadoCuenta: "activa", debeCambiarPassword: false } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    storage: { from: () => ({ list: state.list, remove: state.remove }) },
    from: (table: string) => query(table),
  }),
}));

const actions = await import("./actions");
const t = copy.miLegajo.documentos;

const STORED = [{ name: `${FILE_ID}.pdf`, id: "obj", created_at: new Date().toISOString(), metadata: { size: 120, mimetype: "application/pdf" } }];

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  state.list = vi.fn(async () => ({ data: STORED, error: null }));
  state.remove = vi.fn(async (paths: string[]) => ({ data: paths, error: null }));
  state.resolve = (table, ops) => {
    if (table === "legajos") return { data: { id: "legajo-1" }, error: null };
    if (ops.includes("insert")) return { data: null, error: { code: "XX000", message: "insert failed" } };
    return { data: [], error: null, count: 0 };
  };
  logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

function logged(): string {
  return logSpy.mock.calls.map((call: unknown[]) => call.join(" ")).join("\n");
}

const registrar = () => actions.registrarDocumento({ tipo: "dni_frente", path: PATH, fileName: "dni.pdf" });

describe("registrarDocumento cleanup", () => {
  it("removes the object when the insert fails", async () => {
    await expect(registrar()).resolves.toEqual({ ok: false, error: t.errors.subirFallo });
    expect(state.remove).toHaveBeenCalledWith([PATH]);
  });

  it("removes the object and returns an error when the listing fails", async () => {
    state.list = vi.fn(async () => ({ data: null, error: { message: "list failed" } }));
    await expect(registrar()).resolves.toEqual({ ok: false, error: t.errors.subirFallo });
    expect(state.remove).toHaveBeenCalledWith([PATH]);
  });

  it("removes the object when the stored file does not validate", async () => {
    state.list = vi.fn(async () => ({ data: [{ ...STORED[0], metadata: { size: 120, mimetype: "text/html" } }], error: null }));
    const result = await registrar();
    expect(result.ok).toBe(false);
    expect(state.remove).toHaveBeenCalledWith([PATH]);
  });

  it("surfaces a failed removal with a controlled error and a log without paths", async () => {
    state.remove = vi.fn(async () => ({ data: null, error: { message: "remove failed" } }));
    await expect(registrar()).resolves.toEqual({ ok: false, error: t.errors.limpiezaFallo });
    expect(logged()).toContain("legajo-docs cleanup failed");
    expect(logged()).not.toContain(UID);
    expect(logged()).not.toContain(FILE_ID);
  });

  it("does not remove anything when the document is recorded", async () => {
    state.resolve = (table, ops) => {
      if (table === "legajos") return { data: { id: "legajo-1" }, error: null };
      if (ops.includes("insert")) return { data: { estado: "pendiente" }, error: null };
      return { data: [], error: null, count: 0 };
    };
    await expect(registrar()).resolves.toEqual({ ok: true, data: { estado: "pendiente" } });
    expect(state.remove).not.toHaveBeenCalled();
  });
});

describe("prepararSubidaDocumento sweep", () => {
  const preparar = () =>
    actions.prepararSubidaDocumento({ tipo: "dni_frente", fileName: "dni.pdf", mimeType: "application/pdf", sizeBytes: 120 });

  it("still issues a path when the sweep fails, and notes it without paths", async () => {
    state.list = vi.fn(async () => ({ data: null, error: { message: "list failed" } }));
    const result = await preparar();
    expect(result.ok).toBe(true);
    expect(result.ok && result.data?.path.startsWith(`${UID}/dni_frente/`)).toBe(true);
    expect(logged()).toContain("legajo-docs cleanup failed: sweep");
    expect(logged()).not.toContain(UID);
  });

  it("sweeps only the caller's own folders before issuing the path", async () => {
    await preparar();
    const folders = state.list.mock.calls.map(([folder]) => folder as string);
    expect(folders.length).toBeGreaterThan(0);
    expect(folders.every((folder) => folder.startsWith(`${UID}/`))).toBe(true);
  });
});

describe("descartarSubida", () => {
  it("refuses a path outside the caller's folder without touching Storage", async () => {
    const ajeno = `33333333-3333-4333-8333-333333333333/dni_frente/${FILE_ID}.pdf`;
    await expect(actions.descartarSubida({ path: ajeno })).resolves.toEqual({ ok: false, error: t.errors.subirFallo });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("keeps an object that has its document row", async () => {
    state.resolve = () => ({ data: null, error: null, count: 1 });
    await expect(actions.descartarSubida({ path: PATH })).resolves.toEqual({ ok: true });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("removes a rowless object, and reports a failed removal", async () => {
    await expect(actions.descartarSubida({ path: PATH })).resolves.toEqual({ ok: true });
    expect(state.remove).toHaveBeenCalledWith([PATH]);

    state.remove = vi.fn(async () => ({ data: null, error: { message: "x" } }));
    await expect(actions.descartarSubida({ path: PATH })).resolves.toEqual({ ok: false, error: t.errors.limpiezaFallo });
  });
});
