import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { copy } from "@/lib/copy/es-AR";

// The /legajos actions with Storage and the database replaced by a fake
// session client: the Admin role check, the pending-request lock, and the
// document failure paths (every failure after an upload removes the object
// and checks the removal; the sweep covers only the target employee's folder).

const ADMIN = "11111111-1111-4111-8111-111111111111";
const EMPLEADO = "22222222-2222-4222-8222-222222222222";
const OTRO = "33333333-3333-4333-8333-333333333333";
const FILE_ID = "44444444-4444-4444-8444-444444444444";
const DOC_ID = "55555555-5555-4555-8555-555555555555";
const PATH = `${EMPLEADO}/dni_frente/${FILE_ID}.pdf`;

type Result = { data?: unknown; error?: unknown; count?: number | null };

const state = vi.hoisted(() => ({
  role: "admin" as "admin" | "empleado",
  list: null as unknown as ReturnType<typeof vi.fn>,
  remove: null as unknown as ReturnType<typeof vi.fn>,
  rpc: null as unknown as Mock<(...args: unknown[]) => Promise<unknown>>,
  queries: [] as { table: string; ops: string[] }[],
  resolve: null as unknown as (table: string, ops: string[]) => Result,
}));

// A query builder double: every call is recorded and chains; awaiting it
// resolves through state.resolve.
function query(table: string) {
  const ops: string[] = [];
  state.queries.push({ table, ops });
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
  getSessionUser: async () => ({
    id: state.role === "admin" ? ADMIN : OTRO,
    email: "a@mitsm.test",
    role: state.role,
    cuenta: { estadoCuenta: "activa", debeCambiarPassword: false },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    storage: {
      from: () => ({
        list: state.list,
        remove: state.remove,
        createSignedUrl: async () => ({ data: { signedUrl: "https://signed.test/x" }, error: null }),
      }),
    },
    from: (table: string) => query(table),
    rpc: (...args: unknown[]) => state.rpc(...args),
  }),
}));

const actions = await import("./actions");
const docErrors = copy.miLegajo.documentos.errors;
const STORED = [{ name: `${FILE_ID}.pdf`, id: "obj", created_at: new Date().toISOString(), metadata: { size: 120, mimetype: "application/pdf" } }];
const OLD = new Date(Date.now() - 60 * 60 * 1000).toISOString();

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  state.role = "admin";
  state.queries = [];
  state.list = vi.fn(async () => ({ data: STORED, error: null }));
  state.remove = vi.fn(async (paths: string[]) => ({ data: paths, error: null }));
  state.rpc = vi.fn(async () => ({ data: null, error: { code: "XX000", message: "rpc failed" } }));
  state.resolve = (table, ops) => {
    if (table === "legajos") return { data: { id: "legajo-1" }, error: null };
    if (ops.includes("insert")) return { data: null, error: { code: "XX000", message: "insert failed" } };
    // No approved document to replace, no rows, nothing pending.
    return { data: ops.includes("maybeSingle") ? null : [], error: null, count: 0 };
  };
  logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

function logged(): string {
  return logSpy.mock.calls.map((call: unknown[]) => call.join(" ")).join("\n");
}

const GRUPO_B = {
  calle_altura: "Calle 1",
  piso_depto: "",
  localidad: "Localidad",
  partido: "Tigre",
  partido_otro: null,
  telefono_celular: "11 4444-5555",
  email_personal: "prueba@example.test",
};
const LABORALES = {
  numero_legajo: "L-1",
  area: "Operaciones",
  puesto: "Chofer",
  fecha_ingreso: "2020-03-01",
  estado_laboral: "activo",
  sede: "San Martín",
  modalidad: "Presencial",
  convenio: "Camioneros",
  bruto_mensual: 1000,
};

describe("role boundary", () => {
  it("rejects an Empleado on every action, before touching the database or Storage", async () => {
    state.role = "empleado";
    const noAutorizado = { ok: false, error: copy.cuentas.errors.noAutorizado };
    const calls = [
      actions.actualizarGrupoLegajo({ profileId: EMPLEADO, grupo: "B", valores: GRUPO_B }),
      actions.actualizarDatosLaborales({ profileId: OTRO, valores: LABORALES }),
      actions.prepararSubidaAdmin({ profileId: EMPLEADO, tipo: "dni_frente", fileName: "d.pdf", mimeType: "application/pdf", sizeBytes: 120 }),
      actions.registrarDocumentoAdmin({ profileId: EMPLEADO, tipo: "dni_frente", path: PATH, fileName: "d.pdf" }),
      actions.descartarSubidaAdmin({ profileId: EMPLEADO, path: PATH }),
      actions.eliminarDocumentoAdmin({ profileId: EMPLEADO, documentoId: DOC_ID }),
      actions.obtenerUrlDocumentoAdmin({ profileId: EMPLEADO, documentoId: DOC_ID }),
    ];
    for (const result of await Promise.all(calls)) expect(result).toEqual(noAutorizado);
    expect(state.queries).toEqual([]);
    expect(state.list).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("refuses an input without a valid employee id", async () => {
    const result = await actions.actualizarDatosLaborales({ profileId: "nope", valores: LABORALES });
    expect(result.ok).toBe(false);
    expect(state.queries).toEqual([]);
  });
});

describe("pending change request lock", () => {
  it("refuses groups A to D while a request is pending, without writing", async () => {
    state.resolve = (table) => (table === "solicitudes_cambio" ? { data: null, error: null, count: 1 } : { data: { id: "legajo-1" }, error: null });
    const result = await actions.actualizarGrupoLegajo({ profileId: EMPLEADO, grupo: "B", valores: GRUPO_B });
    expect(result).toEqual({ ok: false, error: copy.legajos.errors.solicitudPendiente });
    expect(state.queries.some((q) => q.ops.includes("update"))).toBe(false);
  });

  it("refuses when the lock cannot be checked", async () => {
    state.resolve = (table) => (table === "solicitudes_cambio" ? { data: null, error: { message: "x" } } : { data: { id: "legajo-1" }, error: null });
    const result = await actions.actualizarGrupoLegajo({ profileId: EMPLEADO, grupo: "B", valores: GRUPO_B });
    expect(result).toEqual({ ok: false, error: copy.aprobaciones.errors.guardarFallo });
    expect(state.queries.some((q) => q.ops.includes("update"))).toBe(false);
  });

  it("writes the group when nothing is pending", async () => {
    state.resolve = (table) => (table === "solicitudes_cambio" ? { data: null, error: null, count: 0 } : { data: { id: "legajo-1" }, error: null });
    expect(await actions.actualizarGrupoLegajo({ profileId: EMPLEADO, grupo: "B", valores: GRUPO_B })).toEqual({ ok: true });
    expect(state.queries.find((q) => q.table === "legajos")?.ops).toContain("update");
  });

  it("maps the database lock to the same message when a request arrives after the check", async () => {
    state.resolve = (table) =>
      table === "solicitudes_cambio"
        ? { data: null, error: null, count: 0 }
        : { data: null, error: { code: "55000", message: "The legajo has a pending change request", hint: "solicitud_pendiente" } };
    const result = await actions.actualizarGrupoLegajo({ profileId: EMPLEADO, grupo: "B", valores: GRUPO_B });
    expect(result).toEqual({ ok: false, error: copy.legajos.errors.solicitudPendiente });
  });

  it("group E does not look at pending requests", async () => {
    state.resolve = () => ({ data: { id: "legajo-1" }, error: null, count: 1 });
    expect(await actions.actualizarDatosLaborales({ profileId: EMPLEADO, valores: LABORALES })).toEqual({ ok: true });
    expect(state.queries.some((q) => q.table === "solicitudes_cambio")).toBe(false);
  });

  it("reports a repeated número de legajo on its field", async () => {
    state.resolve = () => ({ data: null, error: { code: "23505", message: "dup" } });
    const result = await actions.actualizarDatosLaborales({ profileId: EMPLEADO, valores: LABORALES });
    expect(result).toEqual({
      ok: false,
      error: copy.legajos.errors.numeroLegajoDuplicado,
      fieldErrors: { numero_legajo: copy.legajos.errors.numeroLegajoDuplicado },
    });
  });
});

describe("registrarDocumentoAdmin cleanup", () => {
  const registrar = (path = PATH) =>
    actions.registrarDocumentoAdmin({ profileId: EMPLEADO, tipo: "dni_frente", path, fileName: "dni.pdf" });

  it("removes the object when the insert fails", async () => {
    await expect(registrar()).resolves.toEqual({ ok: false, error: docErrors.subirFallo });
    expect(state.remove).toHaveBeenCalledWith([PATH]);
  });

  it("removes the object and returns an error when the listing fails", async () => {
    state.list = vi.fn(async () => ({ data: null, error: { message: "list failed" } }));
    await expect(registrar()).resolves.toEqual({ ok: false, error: docErrors.subirFallo });
    expect(state.remove).toHaveBeenCalledWith([PATH]);
  });

  it("surfaces a failed removal with a controlled error and a log without paths", async () => {
    state.remove = vi.fn(async () => ({ data: null, error: { message: "remove failed" } }));
    await expect(registrar()).resolves.toEqual({ ok: false, error: docErrors.limpiezaFallo });
    expect(logged()).toContain("[legajos] legajo-docs cleanup failed: register");
    expect(logged()).not.toContain(EMPLEADO);
    expect(logged()).not.toContain(FILE_ID);
  });

  it("refuses a path outside the target employee's folder without touching it", async () => {
    await expect(registrar(`${OTRO}/dni_frente/${FILE_ID}.pdf`)).resolves.toEqual({ ok: false, error: docErrors.subirFallo });
    expect(state.list).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("records the upload as the Admin, and removes nothing", async () => {
    state.resolve = (table, ops) => {
      if (table === "legajos") return { data: { id: "legajo-1" }, error: null };
      if (ops.includes("insert")) return { data: { estado: "aprobado" }, error: null };
      return { data: null, error: null };
    };
    await expect(registrar()).resolves.toEqual({ ok: true, data: { estado: "aprobado" } });
    expect(state.remove).not.toHaveBeenCalled();
  });
});

describe("registrarDocumentoAdmin replacing the current document", () => {
  const OLD_PATH = `${EMPLEADO}/dni_frente/66666666-6666-4666-8666-666666666666.pdf`;
  const registrar = (modo?: string) =>
    actions.registrarDocumentoAdmin({ profileId: EMPLEADO, tipo: "dni_frente", path: PATH, fileName: "dni.pdf", ...(modo ? { modo } : {}) });

  beforeEach(() => {
    // An approved document of the type exists.
    state.resolve = (table) => (table === "legajos" ? { data: { id: "legajo-1" }, error: null } : { data: { id: "vigente-1" }, error: null });
  });

  it("needs a mode, and removes the uploaded object without one", async () => {
    await expect(registrar()).resolves.toEqual({ ok: false, error: copy.legajos.documentos.errors.modoRequerido });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.remove).toHaveBeenCalledWith([PATH]);
  });

  it("keeps history: calls the function in that mode and removes nothing", async () => {
    state.rpc = vi.fn(async () => ({ data: [{ documento_id: "nuevo", storage_path_eliminado: null }], error: null }));
    await expect(registrar("conservar")).resolves.toEqual({ ok: true, data: { estado: "aprobado" } });
    expect(state.rpc).toHaveBeenCalledWith("reemplazar_documento", expect.objectContaining({ p_conservar_historial: true, p_storage_path: PATH }));
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("replaces permanently: removes the previous object after the function succeeds", async () => {
    state.rpc = vi.fn(async () => ({ data: [{ documento_id: "nuevo", storage_path_eliminado: OLD_PATH }], error: null }));
    await expect(registrar("definitivo")).resolves.toEqual({ ok: true, data: { estado: "aprobado" } });
    expect(state.rpc).toHaveBeenCalledWith("reemplazar_documento", expect.objectContaining({ p_conservar_historial: false }));
    expect(state.remove).toHaveBeenCalledWith([OLD_PATH]);
  });

  it("returns the cleanup error with a path-free log when removing the previous object fails", async () => {
    state.rpc = vi.fn(async () => ({ data: [{ documento_id: "nuevo", storage_path_eliminado: OLD_PATH }], error: null }));
    state.remove = vi.fn(async () => ({ data: null, error: { message: "remove failed" } }));
    await expect(registrar("definitivo")).resolves.toEqual({ ok: false, error: copy.legajos.documentos.errors.limpiezaFallo });
    // The new file is registered: it is never removed.
    expect(state.remove).toHaveBeenCalledTimes(1);
    expect(state.remove).toHaveBeenCalledWith([OLD_PATH]);
    expect(logged()).toContain("[legajos] legajo-docs cleanup failed: replace");
    expect(logged()).not.toContain(EMPLEADO);
  });

  it("removes the uploaded object when the function refuses (pending document, or any failure)", async () => {
    state.rpc = vi.fn(async () => ({ data: null, error: { code: "55000", hint: "documento_pendiente" } }));
    await expect(registrar("conservar")).resolves.toEqual({ ok: false, error: copy.legajos.errors.documentoPendiente });
    expect(state.remove).toHaveBeenCalledWith([PATH]);
    state.rpc = vi.fn(async () => ({ data: null, error: { code: "23514", message: "check" } }));
    await expect(registrar("definitivo")).resolves.toEqual({ ok: false, error: docErrors.subirFallo });
  });
});

describe("prepararSubidaAdmin", () => {
  const preparar = () =>
    actions.prepararSubidaAdmin({ profileId: EMPLEADO, tipo: "dni_frente", fileName: "dni.pdf", mimeType: "application/pdf", sizeBytes: 120 });

  it("sweeps only the target employee's folders and returns a path there", async () => {
    state.list = vi.fn(async () => ({ data: [{ ...STORED[0], created_at: OLD }], error: null }));
    const result = await preparar();
    expect(result.ok && result.data?.path.startsWith(`${EMPLEADO}/dni_frente/`)).toBe(true);
    const folders = state.list.mock.calls.map(([folder]) => folder as string);
    expect(folders.length).toBeGreaterThan(0);
    expect(folders.every((folder) => folder.startsWith(`${EMPLEADO}/`))).toBe(true);
    // Old and rowless: removed, and only paths in that folder.
    const removed = state.remove.mock.calls.flatMap(([paths]) => paths as string[]);
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.every((path) => path.startsWith(`${EMPLEADO}/`))).toBe(true);
  });

  it("still issues a path when the sweep fails, and notes it without paths", async () => {
    state.list = vi.fn(async () => ({ data: null, error: { message: "list failed" } }));
    const result = await preparar();
    expect(result.ok).toBe(true);
    expect(logged()).toContain("[legajos] legajo-docs cleanup failed: sweep");
    expect(logged()).not.toContain(EMPLEADO);
  });

  it("refuses while the employee has a pending document of that type", async () => {
    state.resolve = () => ({ data: null, error: null, count: 1 });
    await expect(preparar()).resolves.toEqual({ ok: false, error: copy.legajos.errors.documentoPendiente });
  });
});

describe("descartarSubidaAdmin", () => {
  it("refuses a path outside the target employee's folder", async () => {
    const ajeno = `${OTRO}/dni_frente/${FILE_ID}.pdf`;
    await expect(actions.descartarSubidaAdmin({ profileId: EMPLEADO, path: ajeno })).resolves.toEqual({
      ok: false,
      error: docErrors.subirFallo,
    });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("keeps a registered object, removes a rowless one and reports a failed removal", async () => {
    state.resolve = () => ({ data: null, error: null, count: 1 });
    await expect(actions.descartarSubidaAdmin({ profileId: EMPLEADO, path: PATH })).resolves.toEqual({ ok: true });
    expect(state.remove).not.toHaveBeenCalled();

    state.resolve = () => ({ data: null, error: null, count: 0 });
    await expect(actions.descartarSubidaAdmin({ profileId: EMPLEADO, path: PATH })).resolves.toEqual({ ok: true });
    expect(state.remove).toHaveBeenCalledWith([PATH]);

    state.remove = vi.fn(async () => ({ data: null, error: { message: "x" } }));
    await expect(actions.descartarSubidaAdmin({ profileId: EMPLEADO, path: PATH })).resolves.toEqual({
      ok: false,
      error: docErrors.limpiezaFallo,
    });
  });
});

describe("eliminarDocumentoAdmin", () => {
  const documento = (estado: string) => ({ id: DOC_ID, estado, storage_path: PATH, file_name: "dni.pdf" });
  const eliminar = () => actions.eliminarDocumentoAdmin({ profileId: EMPLEADO, documentoId: DOC_ID });

  it("deletes the row, then the object", async () => {
    state.resolve = (_table, ops) => (ops.includes("delete") ? { data: [{ id: DOC_ID }], error: null } : { data: documento("aprobado"), error: null });
    await expect(eliminar()).resolves.toEqual({ ok: true });
    expect(state.remove).toHaveBeenCalledWith([PATH]);
  });

  it("keeps the object when the row could not be deleted", async () => {
    state.resolve = (_table, ops) => (ops.includes("delete") ? { data: null, error: { message: "x" } } : { data: documento("aprobado"), error: null });
    await expect(eliminar()).resolves.toEqual({ ok: false, error: docErrors.eliminarFallo });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("returns the cleanup error when the object removal fails, after deleting the row", async () => {
    state.resolve = (_table, ops) => (ops.includes("delete") ? { data: [{ id: DOC_ID }], error: null } : { data: documento("aprobado"), error: null });
    state.remove = vi.fn(async () => ({ data: null, error: { message: "x" } }));
    await expect(eliminar()).resolves.toEqual({ ok: false, error: docErrors.limpiezaFallo });
    expect(state.queries.some((q) => q.ops.includes("delete"))).toBe(true);
    expect(logged()).toContain("[legajos] legajo-docs cleanup failed: delete");
    expect(logged()).not.toContain(FILE_ID);
  });

  it("does not delete a pending employee upload", async () => {
    state.resolve = () => ({ data: documento("pendiente"), error: null });
    await expect(eliminar()).resolves.toEqual({ ok: false, error: docErrors.eliminarFallo });
    expect(state.queries.some((q) => q.ops.includes("delete"))).toBe(false);
    expect(state.remove).not.toHaveBeenCalled();
  });
});

describe("obtenerUrlDocumentoAdmin", () => {
  it("returns a signed link for a document of the target employee, else an error", async () => {
    state.resolve = () => ({ data: { id: DOC_ID, estado: "pendiente", storage_path: PATH, file_name: "dni.pdf" }, error: null });
    await expect(actions.obtenerUrlDocumentoAdmin({ profileId: EMPLEADO, documentoId: DOC_ID })).resolves.toEqual({
      ok: true,
      data: { url: "https://signed.test/x" },
    });
    state.resolve = () => ({ data: null, error: null });
    await expect(actions.obtenerUrlDocumentoAdmin({ profileId: EMPLEADO, documentoId: DOC_ID })).resolves.toEqual({
      ok: false,
      error: copy.documentos.errors.downloadFailed,
    });
  });
});
