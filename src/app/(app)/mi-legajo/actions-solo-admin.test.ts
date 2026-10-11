import { beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";

// The /mi-legajo document actions refuse the Admin-only type (Alta de AFIP)
// for every role, before any Storage or database write (CR-3). The session
// client is a double that records what it is asked for; the storage policies
// refuse the same writes in the database (tests/integration).

const PROPIO = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "44444444-4444-4444-8444-444444444444";
const DOC_ID = "55555555-5555-4555-8555-555555555555";
const AFIP_PATH = `${PROPIO}/alta_afip/${FILE_ID}.pdf`;

type Result = { data?: unknown; error?: unknown; count?: number | null };

const state = vi.hoisted(() => ({
  role: "empleado" as "admin" | "empleado",
  storage: [] as string[],
  queries: [] as { table: string; ops: string[] }[],
  // The document row found by id (documentoPropio).
  documento: null as null | { id: string; tipo: string; estado: string; storage_path: string; file_name: string },
}));

// A query builder double: records every call, chains, and resolves to the
// document row for a single-row read, else to an empty answer.
function query(table: string) {
  const ops: string[] = [];
  state.queries.push({ table, ops });
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") {
          const result: Result = ops.includes("maybeSingle")
            ? { data: state.documento, error: null }
            : { data: [], error: null, count: 0 };
          return (onFulfilled: (value: Result) => unknown) => Promise.resolve(result).then(onFulfilled);
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

function storageOp(name: string) {
  return async () => {
    state.storage.push(name);
    return name === "createSignedUrl" ? { data: { signedUrl: "https://signed.test/x" }, error: null } : { data: [], error: null };
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => ({
    id: PROPIO,
    email: "a@mitsm.test",
    role: state.role,
    cuenta: { estadoCuenta: "activa", debeCambiarPassword: false },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    storage: {
      from: () => ({
        list: storageOp("list"),
        remove: storageOp("remove"),
        createSignedUrl: storageOp("createSignedUrl"),
      }),
    },
    from: (table: string) => query(table),
  }),
}));

const actions = await import("./actions");
const errors = copy.miLegajo.documentos.errors;
const archivo = { fileName: "alta.pdf", mimeType: "application/pdf", sizeBytes: 120 };
const writes = () => state.queries.filter((q) => q.ops.some((op) => ["insert", "update", "delete"].includes(op)));

beforeEach(() => {
  state.storage = [];
  state.queries = [];
  state.documento = null;
});

describe.each(["empleado", "admin"] as const)("Mi Legajo document actions, %s", (role) => {
  beforeEach(() => {
    state.role = role;
  });

  it("refuses a path for an Alta de AFIP upload, touching nothing", async () => {
    await expect(actions.prepararSubidaDocumento({ tipo: "alta_afip", ...archivo })).resolves.toEqual({
      ok: false,
      error: errors.soloAdmin,
    });
    expect(state.storage).toEqual([]);
    expect(state.queries).toEqual([]);
  });

  it("refuses to register (upload or replace) an Alta de AFIP, touching nothing", async () => {
    for (const extra of [{}, { modo: "conservar" }, { modo: "definitivo" }]) {
      await expect(
        actions.registrarDocumento({ tipo: "alta_afip", path: AFIP_PATH, fileName: "alta.pdf", ...extra }),
      ).resolves.toEqual({ ok: false, error: errors.soloAdmin });
    }
    expect(state.storage).toEqual([]);
    expect(state.queries).toEqual([]);
  });

  it("refuses to discard an object under alta_afip/", async () => {
    await expect(actions.descartarSubida({ path: AFIP_PATH })).resolves.toEqual({ ok: false, error: errors.soloAdmin });
    expect(state.storage).toEqual([]);
  });

  it("refuses to delete an Alta de AFIP, touching nothing", async () => {
    state.documento = { id: DOC_ID, tipo: "alta_afip", estado: "aprobado", storage_path: AFIP_PATH, file_name: "alta.pdf" };
    await expect(actions.eliminarDocumentoPendiente({ documentoId: DOC_ID })).resolves.toEqual({
      ok: false,
      error: errors.soloAdmin,
    });
    expect(state.storage).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it("downloads the own current Alta de AFIP", async () => {
    state.documento = { id: DOC_ID, tipo: "alta_afip", estado: "aprobado", storage_path: AFIP_PATH, file_name: "alta.pdf" };
    await expect(actions.obtenerUrlDocumento({ documentoId: DOC_ID })).resolves.toEqual({
      ok: true,
      data: { url: "https://signed.test/x" },
    });
  });

  it("still prepares an upload of the other types, sweeping only their folders", async () => {
    const result = await actions.prepararSubidaDocumento({ tipo: "dni_frente", ...archivo });
    expect(result.ok && result.data?.path.startsWith(`${PROPIO}/dni_frente/`)).toBe(true);
    expect(state.storage).toEqual(["list", "list", "list"]);
  });
});
