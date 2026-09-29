import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inventarioAcciones } from "@/lib/auth/acciones-inventario.test-helpers";
import { CAMBIAR_PASSWORD_PATH, HOME_PATH, LOGIN_PATH } from "@/lib/auth/gate";
import { LOGIN_INACTIVIDAD } from "@/lib/auth/guardia";
import { copy } from "@/lib/copy/es-AR";
import {
  crearCambioForzado,
  crearDesactivado,
  instantanea,
  nuevaSesion,
  sembrar,
  sesionCerrada,
  type ActorCapturado,
  type Semilla,
} from "./actores";
import { anonClient, createTestUser, deleteTestUsers, serviceClient, TEST_PASSWORD, uniqueEmail, type TestUser } from "./helpers";

// F1-11A, GAP-04: the action boundary matrix. Every Server Action in the
// action inventory (src/lib/auth/acciones-inventario.test-helpers.ts) has an
// entry in CASOS; an action without one fails "covers exactly the
// inventory's actions". For each, against the local stack, with the real
// session user read through the caller's own client (as in
// cambio-forzado-acciones.test.ts):
// - no session, the wrong role, a deactivated account (its session closed by
//   the deactivation, the browser still holding it) and a pending forced
//   password change are refused;
// - a foreign (or, for an Admin, own-account or mismatched) id is refused;
// - invalid input gets a controlled error;
// and nothing any fixture account owns changes (instantanea). The four
// intentional exceptions (login, logout, cerrarSesionPorInactividad,
// cambiarPassword) have their own expected behaviour below, and the five
// Usuarios wrappers their direct behavioural tests.

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
// Outside a request there are no cookies to set.
vi.mock("@/lib/sesion/marca-servidor", () => ({
  sellarActividad: async () => true,
  borrarActividad: async () => undefined,
}));

const miLegajo = await import("@/app/(app)/mi-legajo/actions");
const legajos = await import("@/app/(app)/legajos/actions");
const aprobaciones = await import("@/app/(app)/aprobaciones/actions");
const usuarios = await import("@/app/(app)/usuarios/actions");
const auth = await import("@/lib/auth/actions");

const noAutorizado = { ok: false, error: copy.cuentas.errors.noAutorizado };
const soloAdmin = { ok: false, error: copy.miLegajo.errors.soloAdmin };
const fallo = (error: string) => ({ ok: false, error });
const docErrors = copy.miLegajo.documentos.errors;
const apErrors = copy.aprobaciones.errors;
const cuentaErrors = copy.cuentas.errors;
const TEMPORAL = "Temporal-2026";

const GRUPO_D = {
  grupo_sanguineo: "0+",
  alergias: "Intento",
  medicacion_habitual: "Ninguna",
  obra_social: "OSDE",
  numero_afiliado: "123",
  emergencia_nombre: "Contacto",
  emergencia_parentesco: "Madre",
  emergencia_domicilio: "Calle 2",
  emergencia_telefono: "11 5555-6666",
};
const LABORALES = {
  numero_legajo: `FR-${Date.now()}`,
  area: "Operaciones",
  puesto: "Chofer",
  fecha_ingreso: "2020-03-01",
  estado_laboral: "activo",
  sede: "San Martín",
  modalidad: "Presencial",
  convenio: "Camioneros",
  bruto_mensual: 1000,
};
const SUBIDA = { tipo: "licencia_conducir", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

// propio: the caller's own seeded data (an Admin action targets victima).
// tercero: an employee who owns none of victima's data.
type Contexto = { propio: Semilla; victima: Semilla; tercero: string; desactivado: string };
type Llamada = (x: Contexto) => Promise<unknown>;
type Clase = "empleado" | "admin" | "sesion" | "publica" | "cierre" | "cambio-password";
type Caso = {
  // empleado: any active user (usuarioActivo); admin: an active Admin
  // (sessionWithRole); sesion: mantenerSesion; the rest are the exceptions.
  clase: Clase;
  // Input that would be valid for its caller.
  llamar: Llamada;
  // What every refused state gets.
  rechazo?: unknown;
  // The other role, when the action refuses it (an Empleado on an Admin
  // action is implied for clase "admin").
  rol?: { quien: "admin"; esperado: unknown };
  ajeno?: { llamar: Llamada; esperado: unknown };
  invalido?: { llamar: Llamada; esperado: unknown };
  // Why a column does not apply.
  noAplica?: Partial<Record<"rol" | "ajeno" | "invalido", string>>;
  // Extra "nothing happened" checks outside the snapshot.
  despues?: (x: Contexto) => Promise<void>;
};

const SIN_ID = "takes no id: it acts on the caller's own legajo or folder, from the session";
const GLOBAL = "an Admin reaches every employee's items by design";
let emailIntento = "";

const M = "app/(app)/mi-legajo/actions.ts#";
const A = "app/(app)/aprobaciones/actions.ts#";
const L = "app/(app)/legajos/actions.ts#";
const U = "app/(app)/usuarios/actions.ts#";
const S = "lib/auth/actions.ts#";

const CASOS: Record<string, Caso> = {
  // /mi-legajo
  [`${M}enviarSolicitud`]: {
    clase: "empleado",
    rechazo: noAutorizado,
    llamar: () => miLegajo.enviarSolicitud({ grupo: "D", valores: GRUPO_D }),
    rol: { quien: "admin", esperado: fallo(copy.miLegajo.errors.soloEmpleados) },
    invalido: { llamar: () => miLegajo.enviarSolicitud({ grupo: "Z", valores: {} }), esperado: fallo(apErrors.guardarFallo) },
    noAplica: { ajeno: SIN_ID },
  },
  [`${M}cancelarSolicitud`]: {
    clase: "empleado",
    rechazo: noAutorizado,
    llamar: (x) => miLegajo.cancelarSolicitud({ solicitudId: x.propio.solicitudId }),
    ajeno: { llamar: (x) => miLegajo.cancelarSolicitud({ solicitudId: x.victima.solicitudId }), esperado: fallo(apErrors.noPendiente) },
    invalido: { llamar: () => miLegajo.cancelarSolicitud({ solicitudId: "no-es-uuid" }), esperado: fallo(apErrors.guardarFallo) },
    noAplica: { rol: "any active role may cancel their own request" },
  },
  [`${M}actualizarLegajoPropio`]: {
    clase: "admin",
    rechazo: soloAdmin,
    llamar: () => miLegajo.actualizarLegajoPropio({ grupo: "D", valores: GRUPO_D }),
    invalido: { llamar: () => miLegajo.actualizarLegajoPropio({ grupo: "Z", valores: {} }), esperado: fallo(apErrors.guardarFallo) },
    noAplica: { ajeno: SIN_ID },
  },
  [`${M}prepararSubidaDocumento`]: {
    clase: "empleado",
    rechazo: noAutorizado,
    llamar: () => miLegajo.prepararSubidaDocumento(SUBIDA),
    invalido: { llamar: () => miLegajo.prepararSubidaDocumento({}), esperado: fallo(docErrors.subirFallo) },
    noAplica: { rol: "any active role uploads to their own folder", ajeno: SIN_ID },
  },
  [`${M}registrarDocumento`]: {
    clase: "empleado",
    rechazo: noAutorizado,
    llamar: (x) => miLegajo.registrarDocumento({ tipo: "licencia_conducir", path: x.propio.huerfanoPath, fileName: "a.pdf" }),
    ajeno: {
      llamar: (x) => miLegajo.registrarDocumento({ tipo: "licencia_conducir", path: x.victima.huerfanoPath, fileName: "a.pdf" }),
      esperado: fallo(docErrors.subirFallo),
    },
    invalido: { llamar: () => miLegajo.registrarDocumento({}), esperado: fallo(docErrors.subirFallo) },
    noAplica: { rol: "any active role registers in their own folder" },
  },
  [`${M}descartarSubida`]: {
    clase: "empleado",
    rechazo: noAutorizado,
    llamar: (x) => miLegajo.descartarSubida({ path: x.propio.huerfanoPath }),
    ajeno: { llamar: (x) => miLegajo.descartarSubida({ path: x.victima.huerfanoPath }), esperado: fallo(docErrors.subirFallo) },
    invalido: { llamar: () => miLegajo.descartarSubida({}), esperado: fallo(docErrors.subirFallo) },
    noAplica: { rol: "any active role discards in their own folder" },
  },
  [`${M}eliminarDocumentoPendiente`]: {
    clase: "empleado",
    rechazo: noAutorizado,
    llamar: (x) => miLegajo.eliminarDocumentoPendiente({ documentoId: x.propio.docPendienteId }),
    ajeno: {
      llamar: (x) => miLegajo.eliminarDocumentoPendiente({ documentoId: x.victima.docPendienteId }),
      esperado: fallo(docErrors.eliminarFallo),
    },
    invalido: { llamar: () => miLegajo.eliminarDocumentoPendiente({ documentoId: "x" }), esperado: fallo(docErrors.eliminarFallo) },
    noAplica: { rol: "any active role deletes their own pending upload" },
  },
  [`${M}obtenerUrlDocumento`]: {
    clase: "empleado",
    rechazo: noAutorizado,
    llamar: (x) => miLegajo.obtenerUrlDocumento({ documentoId: x.propio.docPendienteId }),
    ajeno: {
      llamar: (x) => miLegajo.obtenerUrlDocumento({ documentoId: x.victima.docPendienteId }),
      esperado: fallo(copy.documentos.errors.downloadFailed),
    },
    invalido: { llamar: () => miLegajo.obtenerUrlDocumento({ documentoId: "x" }), esperado: fallo(copy.documentos.errors.downloadFailed) },
    noAplica: { rol: "any active role downloads their own documents" },
  },

  // /aprobaciones
  [`${A}aprobarSolicitud`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => aprobaciones.aprobarSolicitud({ solicitudId: x.victima.solicitudId }),
    ajeno: { llamar: (x) => aprobaciones.aprobarSolicitud({ solicitudId: x.propio.solicitudId }), esperado: fallo(apErrors.cuentaPropia) },
    invalido: { llamar: () => aprobaciones.aprobarSolicitud({ solicitudId: "x" }), esperado: fallo(apErrors.guardarFallo) },
  },
  [`${A}rechazarSolicitud`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => aprobaciones.rechazarSolicitud({ solicitudId: x.victima.solicitudId, motivo: "Intento" }),
    ajeno: {
      llamar: (x) => aprobaciones.rechazarSolicitud({ solicitudId: x.propio.solicitudId, motivo: "Intento" }),
      esperado: fallo(apErrors.cuentaPropia),
    },
    invalido: { llamar: () => aprobaciones.rechazarSolicitud({ solicitudId: "x", motivo: "Motivo" }), esperado: fallo(apErrors.guardarFallo) },
  },
  [`${A}aprobarDocumento`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => aprobaciones.aprobarDocumento({ documentoId: x.victima.docPendienteId }),
    ajeno: { llamar: (x) => aprobaciones.aprobarDocumento({ documentoId: x.propio.docPendienteId }), esperado: fallo(apErrors.cuentaPropia) },
    invalido: { llamar: () => aprobaciones.aprobarDocumento({ documentoId: "x" }), esperado: fallo(apErrors.guardarFallo) },
  },
  [`${A}rechazarDocumento`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => aprobaciones.rechazarDocumento({ documentoId: x.victima.docPendienteId, motivo: "Intento" }),
    ajeno: {
      llamar: (x) => aprobaciones.rechazarDocumento({ documentoId: x.propio.docPendienteId, motivo: "Intento" }),
      esperado: fallo(apErrors.cuentaPropia),
    },
    invalido: { llamar: () => aprobaciones.rechazarDocumento({ documentoId: "x", motivo: "Motivo" }), esperado: fallo(apErrors.guardarFallo) },
  },
  [`${A}descargarDocumentoBandeja`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => aprobaciones.descargarDocumentoBandeja({ documentoId: x.victima.docAprobadoId }),
    invalido: {
      llamar: () => aprobaciones.descargarDocumentoBandeja({ documentoId: "x" }),
      esperado: fallo(copy.documentos.errors.downloadFailed),
    },
    noAplica: { ajeno: GLOBAL },
  },
  [`${A}contarPendientesCampana`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: () => aprobaciones.contarPendientesCampana(),
    noAplica: { ajeno: "takes no id", invalido: "takes no input" },
  },

  // /legajos
  [`${L}actualizarGrupoLegajo`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => legajos.actualizarGrupoLegajo({ profileId: x.victima.id, grupo: "D", valores: GRUPO_D }),
    invalido: { llamar: () => legajos.actualizarGrupoLegajo({ profileId: "x", grupo: "D", valores: GRUPO_D }), esperado: fallo(apErrors.guardarFallo) },
    noAplica: { ajeno: GLOBAL },
  },
  [`${L}actualizarDatosLaborales`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => legajos.actualizarDatosLaborales({ profileId: x.victima.id, valores: LABORALES }),
    invalido: { llamar: () => legajos.actualizarDatosLaborales({ profileId: "x", valores: LABORALES }), esperado: fallo(apErrors.guardarFallo) },
    noAplica: { ajeno: GLOBAL },
  },
  [`${L}prepararSubidaAdmin`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => legajos.prepararSubidaAdmin({ profileId: x.victima.id, ...SUBIDA }),
    invalido: { llamar: () => legajos.prepararSubidaAdmin({ profileId: "x", ...SUBIDA }), esperado: fallo(docErrors.subirFallo) },
    noAplica: { ajeno: GLOBAL },
  },
  [`${L}registrarDocumentoAdmin`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) =>
      legajos.registrarDocumentoAdmin({ profileId: x.victima.id, tipo: "licencia_conducir", path: x.victima.huerfanoPath, fileName: "a.pdf" }),
    // A path in another employee's folder than the one named.
    ajeno: {
      llamar: (x) =>
        legajos.registrarDocumentoAdmin({ profileId: x.tercero, tipo: "licencia_conducir", path: x.victima.huerfanoPath, fileName: "a.pdf" }),
      esperado: fallo(docErrors.subirFallo),
    },
    invalido: { llamar: () => legajos.registrarDocumentoAdmin({ profileId: "x" }), esperado: fallo(docErrors.subirFallo) },
  },
  [`${L}descartarSubidaAdmin`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => legajos.descartarSubidaAdmin({ profileId: x.victima.id, path: x.victima.huerfanoPath }),
    ajeno: {
      llamar: (x) => legajos.descartarSubidaAdmin({ profileId: x.tercero, path: x.victima.huerfanoPath }),
      esperado: fallo(docErrors.subirFallo),
    },
    invalido: { llamar: () => legajos.descartarSubidaAdmin({ profileId: "x" }), esperado: fallo(docErrors.subirFallo) },
  },
  [`${L}eliminarDocumentoAdmin`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => legajos.eliminarDocumentoAdmin({ profileId: x.victima.id, documentoId: x.victima.docAprobadoId }),
    // A document of another employee than the one named.
    ajeno: {
      llamar: (x) => legajos.eliminarDocumentoAdmin({ profileId: x.tercero, documentoId: x.victima.docAprobadoId }),
      esperado: fallo(docErrors.eliminarFallo),
    },
    invalido: { llamar: () => legajos.eliminarDocumentoAdmin({ profileId: "x" }), esperado: fallo(docErrors.eliminarFallo) },
  },
  [`${L}obtenerUrlDocumentoAdmin`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => legajos.obtenerUrlDocumentoAdmin({ profileId: x.victima.id, documentoId: x.victima.docAprobadoId }),
    ajeno: {
      llamar: (x) => legajos.obtenerUrlDocumentoAdmin({ profileId: x.tercero, documentoId: x.victima.docAprobadoId }),
      esperado: fallo(copy.documentos.errors.downloadFailed),
    },
    invalido: {
      llamar: () => legajos.obtenerUrlDocumentoAdmin({ profileId: "x" }),
      esperado: fallo(copy.documentos.errors.downloadFailed),
    },
  },

  // /usuarios
  [`${U}crearUsuarioAction`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: () => {
      emailIntento = uniqueEmail("frontera-alta-intento");
      return usuarios.crearUsuarioAction({ email: emailIntento, rol: "admin", passwordTemporal: TEMPORAL });
    },
    invalido: { llamar: () => usuarios.crearUsuarioAction({}), esperado: fallo(cuentaErrors.accionFallo) },
    noAplica: { ajeno: "creates a new account; there is no existing id" },
    despues: async () => {
      const { data } = await serviceClient().auth.admin.listUsers({ perPage: 1000 });
      expect(data.users.map((user) => user.email)).not.toContain(emailIntento);
    },
  },
  [`${U}restablecerPasswordAction`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => usuarios.restablecerPasswordAction({ profileId: x.victima.id, passwordTemporal: TEMPORAL }),
    ajeno: {
      llamar: (x) => usuarios.restablecerPasswordAction({ profileId: x.propio.id, passwordTemporal: TEMPORAL }),
      esperado: fallo(cuentaErrors.cuentaPropia),
    },
    invalido: { llamar: () => usuarios.restablecerPasswordAction({}), esperado: fallo(cuentaErrors.accionFallo) },
    // The password did not change.
    despues: async (x) => {
      await nuevaSesion(x.victima.email);
    },
  },
  [`${U}desactivarCuentaAction`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => usuarios.desactivarCuentaAction({ profileId: x.victima.id, motivo: "Intento" }),
    ajeno: {
      llamar: (x) => usuarios.desactivarCuentaAction({ profileId: x.propio.id, motivo: "Intento" }),
      esperado: fallo(cuentaErrors.cuentaPropia),
    },
    invalido: { llamar: () => usuarios.desactivarCuentaAction({}), esperado: fallo(cuentaErrors.accionFallo) },
  },
  [`${U}reactivarCuentaAction`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => usuarios.reactivarCuentaAction({ profileId: x.desactivado }),
    invalido: { llamar: () => usuarios.reactivarCuentaAction({}), esperado: fallo(cuentaErrors.accionFallo) },
    noAplica: { ajeno: "the caller's own account is active: nothing to reactivate" },
  },
  [`${U}purgarCuentaAction`]: {
    clase: "admin",
    rechazo: noAutorizado,
    llamar: (x) => usuarios.purgarCuentaAction({ profileId: x.victima.id, emailConfirmacion: x.victima.email }),
    ajeno: {
      llamar: (x) => usuarios.purgarCuentaAction({ profileId: x.propio.id, emailConfirmacion: x.propio.email }),
      esperado: fallo(cuentaErrors.cuentaPropia),
    },
    invalido: { llamar: () => usuarios.purgarCuentaAction({}), esperado: fallo(cuentaErrors.accionFallo) },
  },

  // Session and the intentional exceptions (their own describe blocks).
  [`${S}mantenerSesion`]: { clase: "sesion", llamar: () => auth.mantenerSesion() },
  [`${S}login`]: { clase: "publica", llamar: () => auth.login(null, form({})) },
  [`${S}logout`]: { clase: "cierre", llamar: () => auth.logout() },
  [`${S}cerrarSesionPorInactividad`]: { clase: "cierre", llamar: () => auth.cerrarSesionPorInactividad() },
  [`${S}cambiarPassword`]: { clase: "cambio-password", llamar: () => auth.cambiarPassword(null, form({})) },
};

describe("action boundary matrix (GAP-04)", () => {
  const service = serviceClient();
  let admin: TestUser;
  let empleado: TestUser;
  let victima: TestUser;
  let desactivado: ActorCapturado;
  let adminDesactivado: ActorCapturado;
  let forzado: ActorCapturado;
  let adminForzado: ActorCapturado;
  const semillas = new Map<string, Semilla>();
  const otros: string[] = [];
  let ids: string[] = [];

  beforeAll(async () => {
    admin = await createTestUser(service, "frontera-admin", "admin");
    empleado = await createTestUser(service, "frontera-empleado");
    victima = await createTestUser(service, "frontera-victima");
    desactivado = await crearDesactivado(service, admin, "frontera-desactivado");
    adminDesactivado = await crearDesactivado(service, admin, "frontera-admin-desactivado", "admin");
    forzado = await crearCambioForzado(service, admin, "frontera-forzado");
    adminForzado = await crearCambioForzado(service, admin, "frontera-admin-forzado", "admin");
    ids = [admin, empleado, victima, desactivado, adminDesactivado, forzado, adminForzado].map((user) => user.id);
    for (const user of [admin, empleado, victima, desactivado, adminDesactivado, forzado, adminForzado]) {
      semillas.set(user.id, await sembrar(service, user, admin.id));
    }
  }, 120_000);

  afterAll(async () => {
    session.client = null;
    await deleteTestUsers(service, [
      ...otros,
      empleado.id,
      victima.id,
      desactivado.id,
      forzado.id,
      adminDesactivado.id,
      adminForzado.id,
      admin.id,
    ]);
  });

  function contexto(user: TestUser): Contexto {
    return { propio: semillas.get(user.id)!, victima: semillas.get(victima.id)!, tercero: empleado.id, desactivado: desactivado.id };
  }

  // Calls as the given client and checks nothing any fixture account owns
  // changed, also when the action ends in a redirect (thrown).
  async function sinCambios(client: unknown, llamar: () => Promise<unknown>) {
    const antes = await instantanea(service, ids);
    session.client = client;
    let resultado: unknown;
    let lanzado: unknown = null;
    try {
      resultado = await llamar();
    } catch (error) {
      lanzado = error;
    }
    expect(await instantanea(service, ids)).toEqual(antes);
    if (lanzado) throw lanzado;
    return resultado;
  }

  it("covers exactly the inventory's actions (31), each with every applicable column or a reason", () => {
    const claves = inventarioAcciones()
      .map((accion) => accion.clave)
      .sort();
    expect(claves).toHaveLength(31);
    expect(Object.keys(CASOS).sort()).toEqual(claves);
    for (const [clave, caso] of Object.entries(CASOS)) {
      if (caso.clase !== "empleado" && caso.clase !== "admin") continue;
      expect(caso.rechazo, clave).toBeDefined();
      expect(Boolean(caso.ajeno) !== Boolean(caso.noAplica?.ajeno), `${clave}: ajeno`).toBe(true);
      expect(Boolean(caso.invalido) !== Boolean(caso.noAplica?.invalido), `${clave}: invalido`).toBe(true);
      if (caso.clase === "empleado") expect(Boolean(caso.rol) !== Boolean(caso.noAplica?.rol), `${clave}: rol`).toBe(true);
    }
  }, 60_000);

  for (const [clave, caso] of Object.entries(CASOS)) {
    if (caso.clase !== "empleado" && caso.clase !== "admin") continue;
    const esAdmin = caso.clase === "admin";

    describe(clave, () => {
      it("no session: refused, nothing changes", async () => {
        const resultado = await sinCambios(anonClient(), () => caso.llamar(contexto(victima)));
        expect(resultado).toEqual(caso.rechazo);
        await caso.despues?.(contexto(victima));
      });

      if (esAdmin) {
        it("an Empleado: refused, nothing changes", async () => {
          const resultado = await sinCambios(empleado.client, () => caso.llamar(contexto(empleado)));
          expect(resultado).toEqual(caso.rechazo);
          await caso.despues?.(contexto(empleado));
        });
      } else if (caso.rol) {
        const rol = caso.rol;
        it("an Admin: refused, nothing changes", async () => {
          const resultado = await sinCambios(admin.client, () => caso.llamar(contexto(admin)));
          expect(resultado).toEqual(rol.esperado);
        });
      }

      it("a deactivated account (session captured before): refused, nothing changes", async () => {
        const quien = esAdmin ? adminDesactivado : desactivado;
        const resultado = await sinCambios(quien.client, () => caso.llamar(contexto(quien)));
        expect(resultado).toEqual(caso.rechazo);
        await caso.despues?.(contexto(quien));
      });

      it("a pending forced password change: refused, nothing changes", async () => {
        const quien = esAdmin ? adminForzado : forzado;
        const resultado = await sinCambios(quien.client, () => caso.llamar(contexto(quien)));
        expect(resultado).toEqual(caso.rechazo);
        await caso.despues?.(contexto(quien));
      });

      if (caso.ajeno) {
        const ajeno = caso.ajeno;
        it(esAdmin ? "an own-account or mismatched id: refused, nothing changes" : "another employee's id: refused, nothing changes", async () => {
          const quien = esAdmin ? admin : empleado;
          const resultado = await sinCambios(quien.client, () => ajeno.llamar(contexto(quien)));
          expect(resultado).toEqual(ajeno.esperado);
        });
      }

      if (caso.invalido) {
        const invalido = caso.invalido;
        it("invalid input: a controlled error, nothing changes", async () => {
          const quien = esAdmin ? admin : empleado;
          const resultado = await sinCambios(quien.client, () => invalido.llamar(contexto(quien)));
          expect(resultado).toEqual(invalido.esperado);
        });
      }
    });
  }

  describe(`${S}mantenerSesion`, () => {
    const terminada = (sesionTerminada: boolean) => ({ ok: false, error: copy.auth.errors.sesionInactividad, sesionTerminada });

    it("refuses no session, a deactivated account and a pending forced change; only the last keeps the session", async () => {
      expect(await sinCambios(anonClient(), () => auth.mantenerSesion())).toEqual(terminada(true));
      expect(await sinCambios(desactivado.client, () => auth.mantenerSesion())).toEqual(terminada(true));
      expect(await sinCambios(adminDesactivado.client, () => auth.mantenerSesion())).toEqual(terminada(true));
      expect(await sinCambios(forzado.client, () => auth.mantenerSesion())).toEqual(terminada(false));
      expect(await sinCambios(empleado.client, () => auth.mantenerSesion())).toEqual({ ok: true });
    });
  });

  // -------------------------------------------------------------------------
  // The four intentional exceptions.
  // -------------------------------------------------------------------------
  describe(`${S}login (public: it runs before there is a session)`, () => {
    const entrar = (email: string, password: string) => auth.login(null, form({ email, password }));

    it("signs in an active account and sends a pending forced change to its page", async () => {
      await expect(sinCambios(anonClient(), () => entrar(empleado.email, TEST_PASSWORD))).rejects.toThrow(`NEXT_REDIRECT:${HOME_PATH}`);
      await expect(sinCambios(anonClient(), () => entrar(forzado.email, TEST_PASSWORD))).rejects.toThrow(
        `NEXT_REDIRECT:${CAMBIAR_PASSWORD_PATH}`,
      );
    });

    it("refuses a deactivated account with its own message (reading only its own profile), and bad input generically", async () => {
      expect(await sinCambios(anonClient(), () => entrar(desactivado.email, TEST_PASSWORD))).toEqual(
        fallo(copy.auth.errors.cuentaInactiva),
      );
      expect(await sinCambios(anonClient(), () => entrar(empleado.email, "incorrecta-123"))).toEqual(
        fallo(copy.auth.errors.invalidCredentials),
      );
      expect(await sinCambios(anonClient(), () => auth.login(null, form({})))).toEqual(fallo(copy.auth.errors.invalidCredentials));
    });
  });

  describe(`${S}logout and ${S}cerrarSesionPorInactividad (sign-out paths: any session)`, () => {
    let salida: TestUser;
    let salidaForzada: ActorCapturado;

    beforeAll(async () => {
      salida = await createTestUser(service, "frontera-salida");
      salidaForzada = await crearCambioForzado(service, admin, "frontera-salida-forzada");
      otros.push(salida.id, salidaForzada.id);
    }, 60_000);

    it("logout ends the session and goes to the login page, in every state", async () => {
      const activa = await nuevaSesion(salida.email);
      const refresh = (await activa.auth.getSession()).data.session!.refresh_token;
      await expect(sinCambios(activa, () => auth.logout())).rejects.toThrow(`NEXT_REDIRECT:${LOGIN_PATH}`);
      expect(await sesionCerrada(refresh)).toBe(true);

      await expect(sinCambios(salidaForzada.client, () => auth.logout())).rejects.toThrow(`NEXT_REDIRECT:${LOGIN_PATH}`);
      await expect(sinCambios(desactivado.client, () => auth.logout())).rejects.toThrow(`NEXT_REDIRECT:${LOGIN_PATH}`);
      await expect(sinCambios(anonClient(), () => auth.logout())).rejects.toThrow(`NEXT_REDIRECT:${LOGIN_PATH}`);
    });

    it("cerrarSesionPorInactividad ends only this session and shows why, in every state", async () => {
      const esta = await nuevaSesion(salida.email);
      const otra = await nuevaSesion(salida.email);
      const refreshEsta = (await esta.auth.getSession()).data.session!.refresh_token;
      const refreshOtra = (await otra.auth.getSession()).data.session!.refresh_token;
      await expect(sinCambios(esta, () => auth.cerrarSesionPorInactividad())).rejects.toThrow(`NEXT_REDIRECT:${LOGIN_INACTIVIDAD}`);
      expect(await sesionCerrada(refreshEsta)).toBe(true);
      expect(await sesionCerrada(refreshOtra)).toBe(false);

      const forzada = await nuevaSesion(salidaForzada.email);
      await expect(sinCambios(forzada, () => auth.cerrarSesionPorInactividad())).rejects.toThrow(`NEXT_REDIRECT:${LOGIN_INACTIVIDAD}`);
      await expect(sinCambios(desactivado.client, () => auth.cerrarSesionPorInactividad())).rejects.toThrow(
        `NEXT_REDIRECT:${LOGIN_INACTIVIDAD}`,
      );
      await expect(sinCambios(anonClient(), () => auth.cerrarSesionPorInactividad())).rejects.toThrow(`NEXT_REDIRECT:${LOGIN_INACTIVIDAD}`);
    });
  });

  // The valid forced change itself is covered in cambio-forzado-acciones.test.ts.
  describe(`${S}cambiarPassword (allowed with a pending forced change)`, () => {
    const corta = () => auth.cambiarPassword(null, form({ actual: "x", password: "corta", confirmacion: "corta" }));

    it("refuses no session and a deactivated account, nothing changes", async () => {
      for (const client of [anonClient(), desactivado.client, adminDesactivado.client]) {
        expect(await sinCambios(client, corta)).toEqual(noAutorizado);
      }
    });

    it("lets a pending forced change and an active user through to validation (controlled error), nothing changes", async () => {
      for (const client of [forzado.client, adminForzado.client, empleado.client]) {
        expect(await sinCambios(client, corta)).toEqual(fallo(copy.password.errors.demasiadoCorta));
      }
    });
  });

  // -------------------------------------------------------------------------
  // The five Usuarios wrappers, behaviour (their refusals are in the matrix).
  // -------------------------------------------------------------------------
  describe("/usuarios wrappers, as an active Admin", () => {
    const perfil = async (id: string) =>
      (await service.from("profiles").select("estado_cuenta, debe_cambiar_password").eq("id", id).maybeSingle()).data;
    const puedeEntrar = async (email: string, password: string) =>
      (await anonClient().auth.signInWithPassword({ email, password })).error === null;

    it("crearUsuarioAction creates the account with a temporary password and the forced change", async () => {
      session.client = admin.client;
      const email = uniqueEmail("frontera-alta");
      const result = await usuarios.crearUsuarioAction({ email, rol: "empleado", passwordTemporal: TEMPORAL });
      expect(result).toEqual({ ok: true, data: { profileId: expect.any(String) } });
      const id = result.ok ? result.data!.profileId : "";
      otros.push(id);
      expect(await perfil(id)).toEqual({ estado_cuenta: "activa", debe_cambiar_password: true });
      const { data: eventos } = await service.from("cuenta_eventos").select("tipo, actor_id").eq("profile_id", id);
      expect(eventos).toEqual([{ tipo: "creacion", actor_id: admin.id }]);
      expect(await puedeEntrar(email, TEMPORAL)).toBe(true);
    });

    it("restablecerPasswordAction sets the temporary password and flags the change", async () => {
      const target = await createTestUser(service, "frontera-restablecer");
      otros.push(target.id);
      session.client = admin.client;
      expect(await usuarios.restablecerPasswordAction({ profileId: target.id, passwordTemporal: TEMPORAL })).toEqual({ ok: true });
      expect(await perfil(target.id)).toEqual({ estado_cuenta: "activa", debe_cambiar_password: true });
      expect(await puedeEntrar(target.email, TEMPORAL)).toBe(true);
      expect(await puedeEntrar(target.email, TEST_PASSWORD)).toBe(false);
    });

    it("desactivarCuentaAction and reactivarCuentaAction change the state and the ban", async () => {
      const target = await createTestUser(service, "frontera-baja");
      otros.push(target.id);
      session.client = admin.client;
      expect(await usuarios.desactivarCuentaAction({ profileId: target.id, motivo: "Prueba F1-11A" })).toEqual({ ok: true });
      expect((await perfil(target.id))?.estado_cuenta).toBe("inactiva");
      expect(await puedeEntrar(target.email, TEST_PASSWORD)).toBe(false);

      expect(await usuarios.reactivarCuentaAction({ profileId: target.id })).toEqual({ ok: true });
      expect((await perfil(target.id))?.estado_cuenta).toBe("activa");
      expect(await puedeEntrar(target.email, TEST_PASSWORD)).toBe(true);
    });

    it("purgarCuentaAction removes the account and returns only the outcome", async () => {
      const target = await createTestUser(service, "frontera-purga");
      session.client = admin.client;
      expect(await usuarios.purgarCuentaAction({ profileId: target.id, emailConfirmacion: target.email })).toEqual({ ok: true });
      expect(await perfil(target.id)).toBeNull();
      expect((await service.auth.admin.getUserById(target.id)).data.user).toBeNull();
    });
  });
});
