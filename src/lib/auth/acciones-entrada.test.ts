import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { copyRecibos } from "@/lib/copy/recibos";
import { inventarioAcciones } from "./acciones-inventario.test-helpers";

// Strict inputs (AUD-SEC-01-01, TSM-F2-SEC-02): every Server Action refuses
// an unknown key at every level of its input (FormData: any field outside
// the form's own) with its generic error, before any I/O. The session guard
// runs for real over a fake session; every other way out (the session-bound
// client, the Admin account module, the current-password check, the activity
// marker, revalidation, server logs) is a spy. Each case also runs once with
// its valid input, to show the same input without the extra key does reach
// I/O. The table covers the whole action inventory.

const ADMIN = "11111111-1111-4111-8111-111111111111";
const EMPLEADO = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const FILE_ID = "44444444-4444-4444-8444-444444444444";

type Rol = "admin" | "empleado";
type Fn = Mock<(...args: unknown[]) => unknown>;

const mocks = vi.hoisted(() => ({
  rol: "admin" as "admin" | "empleado",
  // Every call on the session-bound client, as "from", "storage.from", "auth.signOut"…
  io: [] as string[],
  getSessionUser: null as unknown as Fn,
  createClient: null as unknown as Fn,
  revalidatePath: null as unknown as Fn,
  redirect: null as unknown as Fn,
  cuentas: {} as Record<string, Fn>,
  marca: {} as Record<string, Fn>,
  verifyCurrentPassword: null as unknown as Fn,
  privilegiado: {} as Record<string, Fn>,
}));

// A client double: any chain of calls is recorded and chains on; awaiting a
// call resolves to a failed query. The client itself is not awaitable.
function cadena(ruta: string[]): unknown {
  return new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") {
        return (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { code: "doble", message: "doble" }, count: null }).then(onFulfilled, onRejected);
      }
      return cadena([...ruta, String(prop)]);
    },
    apply() {
      mocks.io.push(ruta.join("."));
      return cadena(ruta);
    },
  });
}
const cliente = () =>
  new Proxy({}, { get: (_target, prop) => (prop === "then" ? undefined : cadena([String(prop)])) });

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => mocks.revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => mocks.redirect(...args) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => mocks.getSessionUser() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => mocks.createClient() }));
vi.mock("@/lib/admin/cuentas", () => {
  const nombres = ["crearUsuario", "resetPasswordTemporal", "desactivarCuenta", "reactivarCuenta", "purgarCuenta"];
  return Object.fromEntries(nombres.map((nombre) => [nombre, (...args: unknown[]) => mocks.cuentas[nombre](...args)]));
});
vi.mock("@/lib/sesion/marca-servidor", () => ({
  sellarActividad: (...args: unknown[]) => mocks.marca.sellarActividad(...args),
  borrarActividad: (...args: unknown[]) => mocks.marca.borrarActividad(...args),
}));
vi.mock("@/lib/auth/verify-password", () => ({ verifyCurrentPassword: (...args: unknown[]) => mocks.verifyCurrentPassword(...args) }));
// The receipts privileged storage client (F2-04).
const PRIVILEGIADO = ["crearUrlSubidaReciboPrivilegiada", "descargarRecibo", "eliminarRecibo", "barrerHuerfanos"];
vi.mock("@/lib/recibos/cliente-privilegiado", () => {
  const nombres = ["crearUrlSubidaReciboPrivilegiada", "descargarRecibo", "eliminarRecibo", "barrerHuerfanos"];
  return Object.fromEntries(nombres.map((nombre) => [nombre, (...args: unknown[]) => mocks.privilegiado[nombre](...args)]));
});

const miLegajo = await import("@/app/(app)/mi-legajo/actions");
const legajos = await import("@/app/(app)/legajos/actions");
const configuracion = await import("@/app/(app)/configuracion/actions");
const aprobaciones = await import("@/app/(app)/aprobaciones/actions");
const usuarios = await import("@/app/(app)/usuarios/actions");
const recibos = await import("@/app/(app)/recibos/actions");
const auth = await import("./actions");

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.rol = "admin";
  mocks.io.length = 0;
  mocks.getSessionUser = vi.fn<(...args: unknown[]) => unknown>(async () => ({
    id: mocks.rol === "admin" ? ADMIN : EMPLEADO,
    email: "persona@mitsm.test",
    role: mocks.rol,
    cuenta: { estadoCuenta: "activa", debeCambiarPassword: false },
  }));
  mocks.createClient = vi.fn<(...args: unknown[]) => unknown>(async () => cliente());
  mocks.revalidatePath = vi.fn<(...args: unknown[]) => unknown>();
  mocks.redirect = vi.fn<(...args: unknown[]) => unknown>(() => {
    throw new Error("redirect");
  });
  for (const nombre of ["crearUsuario", "resetPasswordTemporal", "desactivarCuenta", "reactivarCuenta", "purgarCuenta"]) {
    mocks.cuentas[nombre] = vi.fn<(...args: unknown[]) => unknown>(async () => ({ ok: false, error: "x" }));
  }
  mocks.marca.sellarActividad = vi.fn<(...args: unknown[]) => unknown>(async () => true);
  mocks.marca.borrarActividad = vi.fn<(...args: unknown[]) => unknown>(async () => undefined);
  mocks.verifyCurrentPassword = vi.fn<(...args: unknown[]) => unknown>(async () => false);
  for (const nombre of PRIVILEGIADO) {
    mocks.privilegiado[nombre] = vi.fn<(...args: unknown[]) => unknown>(async () => ({ ok: false }));
  }
  errorLog?.mockRestore();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// Nothing left the action except the session guard.
function sinIO() {
  expect(mocks.createClient).not.toHaveBeenCalled();
  expect(mocks.io).toEqual([]);
  for (const spy of [...Object.values(mocks.cuentas), ...Object.values(mocks.marca), ...Object.values(mocks.privilegiado)]) {
    expect(spy).not.toHaveBeenCalled();
  }
  expect(mocks.verifyCurrentPassword).not.toHaveBeenCalled();
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
  expect(mocks.redirect).not.toHaveBeenCalled();
  expect(errorLog).not.toHaveBeenCalled();
}

function huboIO(): boolean {
  return (
    mocks.createClient.mock.calls.length > 0 ||
    [...Object.values(mocks.cuentas), ...Object.values(mocks.privilegiado)].some((spy) => spy.mock.calls.length > 0)
  );
}

function formulario(campos: Record<string, string>): FormData {
  const form = new FormData();
  for (const [clave, valor] of Object.entries(campos)) form.append(clave, valor);
  return form;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
const HIJO = { nombre_completo: "Ana Pérez", fecha_nacimiento: "2010-01-01" };
const grupoC = (extraValores = {}, extraHijo = {}) => ({
  grupo: "C",
  valores: { estado_civil: "soltero", nombre_conyuge: null, tiene_hijos: true, hijos: [{ ...HIJO, ...extraHijo }], ...extraValores },
});
// The extra-key variants of a group input, at the root, in the values and in a child.
const variantesGrupo = (base: Record<string, unknown>) => [
  { ...base, ...grupoC(), extra: 1 },
  { ...base, ...grupoC(), extra: undefined },
  { ...base, ...grupoC({ extra: "x" }) },
  { ...base, ...grupoC({ legajo_id: ID }) },
  { ...base, ...grupoC({}, { extra: "x" }) },
  { ...base, ...grupoC({}, { legajo_id: ID }) },
];
const raiz = (input: Record<string, unknown>) => [
  { ...input, extra: 1 },
  { ...input, extra: undefined },
  { ...input, profile_id: ID },
];

const subida = { tipo: "dni_frente", fileName: "dni.pdf", mimeType: "application/pdf", sizeBytes: 120 };
const pathDe = (profileId: string) => `${profileId}/dni_frente/${FILE_ID}.pdf`;
const reciboPath = `${EMPLEADO}/${ID}/${FILE_ID}.pdf`;
const filtros = { busqueda: "", estadoLaboral: "", areaId: "", sucursalId: "", tareaId: "", mostrarBajas: false };
const exportacion = (extraFiltros = {}, extraSeleccion = {}) => ({
  filtros: { ...filtros, ...extraFiltros },
  seleccion: { campos: ["nombres"], hijos: false, ...extraSeleccion },
});

const e = {
  guardar: copy.aprobaciones.errors.guardarFallo,
  subir: copy.miLegajo.documentos.errors.subirFallo,
  eliminar: copy.miLegajo.documentos.errors.eliminarFallo,
  descarga: copy.documentos.errors.downloadFailed,
  exportar: copy.exportacion.errors.seleccion,
  configuracion: copy.configuracion.errors.accionFallo,
  cuentas: copy.cuentas.errors.accionFallo,
  login: copy.auth.errors.invalidCredentials,
  password: copy.password.errors.guardarFallo,
  recibosAccion: copyRecibos.errors.accionFallo,
  recibosSubida: copyRecibos.errors.subidaFallo,
  recibosRegistro: copyRecibos.errors.registroFallo,
  recibosVer: copyRecibos.errors.verFallo,
};

type Caso = {
  clave: string;
  rol: Rol;
  // Calls the action with one input (an object, a FormData, or the argument list).
  llamar: (input: unknown) => Promise<unknown>;
  valido: unknown;
  extras: unknown[];
  rechazo: unknown;
};

const fallo = (error: string) => ({ ok: false, error });
const caso = (
  clave: string,
  rol: Rol,
  accion: (input: unknown) => Promise<unknown>,
  valido: unknown,
  extras: unknown[],
  error: string,
): Caso => ({ clave, rol, llamar: accion, valido, extras, rechazo: fallo(error) });

const conPerfil = (input: Record<string, unknown>) => ({ profileId: EMPLEADO, ...input });

const CASOS: Caso[] = [
  // Mi Legajo
  caso("app/(app)/mi-legajo/actions.ts#enviarSolicitud", "empleado", miLegajo.enviarSolicitud, grupoC(), variantesGrupo({}), e.guardar),
  caso("app/(app)/mi-legajo/actions.ts#cancelarSolicitud", "empleado", miLegajo.cancelarSolicitud, { solicitudId: ID }, raiz({ solicitudId: ID }), e.guardar),
  caso("app/(app)/mi-legajo/actions.ts#actualizarLegajoPropio", "admin", miLegajo.actualizarLegajoPropio, grupoC(), variantesGrupo({}), e.guardar),
  caso("app/(app)/mi-legajo/actions.ts#prepararSubidaDocumento", "empleado", miLegajo.prepararSubidaDocumento, subida, raiz(subida), e.subir),
  caso(
    "app/(app)/mi-legajo/actions.ts#registrarDocumento",
    "empleado",
    miLegajo.registrarDocumento,
    { tipo: "dni_frente", path: pathDe(EMPLEADO), fileName: "dni.pdf" },
    raiz({ tipo: "dni_frente", path: pathDe(EMPLEADO), fileName: "dni.pdf" }),
    e.subir,
  ),
  caso("app/(app)/mi-legajo/actions.ts#descartarSubida", "empleado", miLegajo.descartarSubida, { path: pathDe(EMPLEADO) }, raiz({ path: pathDe(EMPLEADO) }), e.subir),
  caso("app/(app)/mi-legajo/actions.ts#eliminarDocumentoPendiente", "empleado", miLegajo.eliminarDocumentoPendiente, { documentoId: ID }, raiz({ documentoId: ID }), e.eliminar),
  caso("app/(app)/mi-legajo/actions.ts#obtenerUrlDocumento", "empleado", miLegajo.obtenerUrlDocumento, { documentoId: ID }, raiz({ documentoId: ID }), e.descarga),

  // Legajos
  caso("app/(app)/legajos/actions.ts#actualizarGrupoLegajo", "admin", legajos.actualizarGrupoLegajo, conPerfil(grupoC()), variantesGrupo({ profileId: EMPLEADO }), e.guardar),
  caso(
    "app/(app)/legajos/actions.ts#actualizarDatosLaborales",
    "admin",
    legajos.actualizarDatosLaborales,
    conPerfil({ valores: { numero_legajo: "100" } }),
    [...raiz(conPerfil({ valores: { numero_legajo: "100" } })), conPerfil({ valores: { numero_legajo: "100", extra: 1 } }), conPerfil({ valores: { bruto_mensual: 1 } })],
    e.guardar,
  ),
  caso("app/(app)/legajos/actions.ts#prepararSubidaAdmin", "admin", legajos.prepararSubidaAdmin, conPerfil(subida), raiz(conPerfil(subida)), e.subir),
  caso(
    "app/(app)/legajos/actions.ts#registrarDocumentoAdmin",
    "admin",
    legajos.registrarDocumentoAdmin,
    conPerfil({ tipo: "dni_frente", path: pathDe(EMPLEADO), fileName: "dni.pdf", modo: "conservar" }),
    raiz(conPerfil({ tipo: "dni_frente", path: pathDe(EMPLEADO), fileName: "dni.pdf", modo: "conservar" })),
    e.subir,
  ),
  caso("app/(app)/legajos/actions.ts#descartarSubidaAdmin", "admin", legajos.descartarSubidaAdmin, conPerfil({ path: pathDe(EMPLEADO) }), raiz(conPerfil({ path: pathDe(EMPLEADO) })), e.subir),
  caso("app/(app)/legajos/actions.ts#eliminarDocumentoAdmin", "admin", legajos.eliminarDocumentoAdmin, conPerfil({ documentoId: ID }), raiz(conPerfil({ documentoId: ID })), e.eliminar),
  caso("app/(app)/legajos/actions.ts#obtenerUrlDocumentoAdmin", "admin", legajos.obtenerUrlDocumentoAdmin, conPerfil({ documentoId: ID }), raiz(conPerfil({ documentoId: ID })), e.descarga),
  caso(
    "app/(app)/legajos/actions.ts#exportarLegajos",
    "admin",
    legajos.exportarLegajos,
    exportacion(),
    [...raiz(exportacion()), exportacion({ extra: 1 }), exportacion({}, { extra: 1 })],
    e.exportar,
  ),

  // Configuración (already strict, CR-5.10; unchanged)
  caso("app/(app)/configuracion/actions.ts#agregarItem", "admin", configuracion.agregarItem, { lista: "sucursal", nombre: "Tigre" }, raiz({ lista: "sucursal", nombre: "Tigre" }), e.configuracion),
  caso("app/(app)/configuracion/actions.ts#renombrarItem", "admin", configuracion.renombrarItem, { id: ID, version: 1, nombre: "Tigre" }, raiz({ id: ID, version: 1, nombre: "Tigre" }), e.configuracion),
  caso("app/(app)/configuracion/actions.ts#desactivarItem", "admin", configuracion.desactivarItem, { id: ID, version: 1 }, raiz({ id: ID, version: 1 }), e.configuracion),
  caso("app/(app)/configuracion/actions.ts#reactivarItem", "admin", configuracion.reactivarItem, { id: ID, version: 1 }, raiz({ id: ID, version: 1 }), e.configuracion),
  caso("app/(app)/configuracion/actions.ts#moverItem", "admin", configuracion.moverItem, { id: ID, version: 1, direccion: "arriba" }, raiz({ id: ID, version: 1, direccion: "arriba" }), e.configuracion),
  caso("app/(app)/configuracion/actions.ts#eliminarItem", "admin", configuracion.eliminarItem, { id: ID, version: 1 }, raiz({ id: ID, version: 1 }), e.configuracion),
  caso(
    "app/(app)/configuracion/actions.ts#asignarSucursalDefecto",
    "admin",
    configuracion.asignarSucursalDefecto,
    { id: ID, version: 1, sucursalId: ID },
    raiz({ id: ID, version: 1, sucursalId: ID }),
    e.configuracion,
  ),

  // Aprobaciones
  caso("app/(app)/aprobaciones/actions.ts#aprobarSolicitud", "admin", aprobaciones.aprobarSolicitud, { solicitudId: ID }, raiz({ solicitudId: ID }), e.guardar),
  caso("app/(app)/aprobaciones/actions.ts#rechazarSolicitud", "admin", aprobaciones.rechazarSolicitud, { solicitudId: ID, motivo: "Falta el dato" }, raiz({ solicitudId: ID, motivo: "Falta el dato" }), e.guardar),
  caso("app/(app)/aprobaciones/actions.ts#aprobarDocumento", "admin", aprobaciones.aprobarDocumento, { documentoId: ID }, raiz({ documentoId: ID }), e.guardar),
  caso("app/(app)/aprobaciones/actions.ts#rechazarDocumento", "admin", aprobaciones.rechazarDocumento, { documentoId: ID, motivo: "Ilegible" }, raiz({ documentoId: ID, motivo: "Ilegible" }), e.guardar),
  caso("app/(app)/aprobaciones/actions.ts#descargarDocumentoBandeja", "admin", aprobaciones.descargarDocumentoBandeja, { documentoId: ID }, raiz({ documentoId: ID }), e.descarga),
  {
    // No input: any argument is refused.
    clave: "app/(app)/aprobaciones/actions.ts#contarPendientesCampana",
    rol: "admin",
    llamar: (args) => aprobaciones.contarPendientesCampana(...(args as unknown[])),
    valido: [],
    extras: [[{}], [{ extra: 1 }], [undefined]],
    rechazo: fallo(e.guardar),
  },

  // Usuarios
  caso(
    "app/(app)/usuarios/actions.ts#crearUsuarioAction",
    "admin",
    usuarios.crearUsuarioAction,
    { email: "nuevo@mitsm.test", rol: "empleado", passwordTemporal: "Temporal-2026" },
    raiz({ email: "nuevo@mitsm.test", rol: "empleado", passwordTemporal: "Temporal-2026" }),
    e.cuentas,
  ),
  caso(
    "app/(app)/usuarios/actions.ts#restablecerPasswordAction",
    "admin",
    usuarios.restablecerPasswordAction,
    { profileId: ID, passwordTemporal: "Temporal-2026" },
    raiz({ profileId: ID, passwordTemporal: "Temporal-2026" }),
    e.cuentas,
  ),
  caso("app/(app)/usuarios/actions.ts#desactivarCuentaAction", "admin", usuarios.desactivarCuentaAction, { profileId: ID, motivo: "Baja" }, raiz({ profileId: ID, motivo: "Baja" }), e.cuentas),
  caso("app/(app)/usuarios/actions.ts#reactivarCuentaAction", "admin", usuarios.reactivarCuentaAction, { profileId: ID }, raiz({ profileId: ID }), e.cuentas),
  caso(
    "app/(app)/usuarios/actions.ts#purgarCuentaAction",
    "admin",
    usuarios.purgarCuentaAction,
    { profileId: ID, emailConfirmacion: "x@mitsm.test" },
    raiz({ profileId: ID, emailConfirmacion: "x@mitsm.test" }),
    e.cuentas,
  ),

  // Recibos (F2-04)
  caso("app/(app)/recibos/actions.ts#crearPeriodoRecibos", "admin", recibos.crearPeriodoRecibos, { anio: 2026, mes: 11 }, raiz({ anio: 2026, mes: 11 }), e.recibosAccion),
  caso("app/(app)/recibos/actions.ts#publicarPeriodoRecibos", "admin", recibos.publicarPeriodoRecibos, { periodoId: ID }, raiz({ periodoId: ID }), e.recibosAccion),
  caso("app/(app)/recibos/actions.ts#cerrarPeriodoRecibos", "admin", recibos.cerrarPeriodoRecibos, { periodoId: ID }, raiz({ periodoId: ID }), e.recibosAccion),
  caso("app/(app)/recibos/actions.ts#reabrirPeriodoRecibos", "admin", recibos.reabrirPeriodoRecibos, { periodoId: ID }, raiz({ periodoId: ID }), e.recibosAccion),
  caso(
    "app/(app)/recibos/actions.ts#prepararSubidaRecibo",
    "admin",
    recibos.prepararSubidaRecibo,
    { periodoId: ID, empleadoId: EMPLEADO, tamano: 1024, tipo: "application/pdf" },
    raiz({ periodoId: ID, empleadoId: EMPLEADO, tamano: 1024, tipo: "application/pdf" }),
    e.recibosSubida,
  ),
  caso(
    "app/(app)/recibos/actions.ts#registrarRecibo",
    "admin",
    recibos.registrarRecibo,
    { periodoId: ID, empleadoId: EMPLEADO, path: reciboPath, confirmarDni: "sin_dni", confirmarReemplazo: true },
    [
      ...raiz({ periodoId: ID, empleadoId: EMPLEADO, path: reciboPath }),
      { periodoId: ID, empleadoId: EMPLEADO, path: reciboPath, confirmarDni: "otro" },
      { periodoId: ID, empleadoId: EMPLEADO, path: reciboPath, overrideMotivo: "sin_dni" },
    ],
    e.recibosRegistro,
  ),
  caso(
    "app/(app)/recibos/actions.ts#descartarSubidaRecibo",
    "admin",
    recibos.descartarSubidaRecibo,
    { periodoId: ID, empleadoId: EMPLEADO, path: reciboPath },
    raiz({ periodoId: ID, empleadoId: EMPLEADO, path: reciboPath }),
    e.recibosAccion,
  ),
  caso("app/(app)/recibos/actions.ts#obtenerUrlReciboAdmin", "admin", recibos.obtenerUrlReciboAdmin, { reciboId: ID }, raiz({ reciboId: ID }), e.recibosVer),

  // Sign-in and password (FormData: the form's own fields only)
  caso(
    "lib/auth/actions.ts#login",
    "empleado",
    (form) => auth.login(null, form as FormData),
    formulario({ email: "persona@mitsm.test", password: "Clave-2026", volver: "/mi-legajo" }),
    [
      formulario({ email: "persona@mitsm.test", password: "Clave-2026", extra: "x" }),
      formulario({ email: "persona@mitsm.test", password: "Clave-2026", rol: "admin" }),
      formulario({ email: "persona@mitsm.test", password: "Clave-2026", "$action_x": "minúscula" }),
      { email: "persona@mitsm.test", password: "Clave-2026" },
    ],
    e.login,
  ),
  caso(
    "lib/auth/actions.ts#cambiarPassword",
    "empleado",
    (form) => auth.cambiarPassword(null, form as FormData),
    formulario({ actual: "Clave-2026", password: "Nueva-Clave-2026", confirmacion: "Nueva-Clave-2026" }),
    [
      formulario({ actual: "Clave-2026", password: "Nueva-Clave-2026", confirmacion: "Nueva-Clave-2026", extra: "x" }),
      formulario({ password: "Nueva-Clave-2026", confirmacion: "Nueva-Clave-2026", debe_cambiar_password: "false" }),
      { actual: "Clave-2026", password: "Nueva-Clave-2026", confirmacion: "Nueva-Clave-2026" },
    ],
    e.password,
  ),
  {
    // No input: any argument is refused, without ending the session.
    clave: "lib/auth/actions.ts#mantenerSesion",
    rol: "empleado",
    llamar: (args) => auth.mantenerSesion(...(args as unknown[])),
    valido: [],
    extras: [[{}], [{ extra: 1 }], [undefined]],
    rechazo: { ok: false, error: copy.auth.errors.sesionInactividad, sesionTerminada: false },
  },
];

// The sign-out paths take no input and never read their arguments (logout is
// a form action: React passes it the previous state and the form). Refusing
// an argument would keep a session alive, so they sign out whatever they get.
const EXENTAS = ["lib/auth/actions.ts#logout", "lib/auth/actions.ts#cerrarSesionPorInactividad"];

describe("strict inputs", () => {
  it("cover every action of the inventory, once", () => {
    const inventario = inventarioAcciones().map((accion) => accion.clave).sort();
    const claves = [...CASOS.map((c) => c.clave), ...EXENTAS].sort();
    expect(new Set(claves).size).toBe(claves.length);
    expect(claves).toEqual(inventario);
    expect(inventario).toHaveLength(47);
  });

  describe.each(CASOS.map((c) => [c.clave, c] as const))("%s", (_clave, c) => {
    it("refuses an unknown key at every level, with its generic error, before any I/O", async () => {
      mocks.rol = c.rol;
      expect(c.extras.length).toBeGreaterThan(0);
      for (const extra of c.extras) {
        await expect(c.llamar(extra), String(c.extras.indexOf(extra))).resolves.toEqual(c.rechazo);
      }
      sinIO();
    });

    it("reaches I/O with the same input without the extra key", async () => {
      mocks.rol = c.rol;
      await c.llamar(c.valido).catch(() => undefined);
      // The two no-input actions have no I/O of their own beyond the guard
      // (mantenerSesion) or read through the inbox module (the bell).
      if (c.clave.endsWith("#mantenerSesion")) {
        expect(mocks.getSessionUser).toHaveBeenCalled();
      } else {
        expect(huboIO()).toBe(true);
      }
    });
  });

  describe.each(EXENTAS)("%s", (clave) => {
    it("ignores any argument and signs out", async () => {
      const accion = clave.endsWith("#logout") ? auth.logout : auth.cerrarSesionPorInactividad;
      const llamar = accion as (...args: unknown[]) => Promise<unknown>;
      await llamar(null, formulario({ extra: "x" })).catch(() => undefined);
      expect(mocks.io.some((llamada) => llamada.startsWith("auth.signOut"))).toBe(true);
      expect(mocks.marca.borrarActividad).toHaveBeenCalled();
    });
  });
});
