import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { hoyEnArgentina } from "@/lib/legajo/fechas";
import { legajoIdDe } from "./actores";
import { createTestUser, deleteTestUsers, serviceClient, type TestUser } from "./helpers";

// F1-11B, GAP-07: validation at the server boundary (PRD 5.7). Through the
// real Server Actions, invalid values are rejected with the field error and
// nothing is stored; the valid value next to each boundary is accepted. As in
// mi-legajo-actions.test.ts, the session-bound server client is the signed-in
// test user's client and the session user is that user, so RLS applies.
const session = vi.hoisted(() => ({
  client: null as unknown,
  user: null as null | { id: string; email: string; role: "empleado" | "admin"; cuenta: unknown },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));

const miLegajo = await import("@/app/(app)/mi-legajo/actions");
const legajos = await import("@/app/(app)/legajos/actions");

const ACTIVA = { estadoCuenta: "activa", debeCambiarPassword: false };
const v = copy.legajo.validation;
const rechazo = (campo: string, mensaje: string) => ({
  ok: false,
  error: copy.miLegajo.errors.revisarCampos,
  fieldErrors: { [campo]: mensaje },
});

const GRUPO_B = {
  calle_altura: "Calle 1",
  piso_depto: "",
  localidad: "Localidad",
  partido: "Tigre",
  partido_otro: null,
  telefono_celular: "11 4444-5555",
  email_personal: "prueba@example.test",
};
const GRUPO_D = {
  grupo_sanguineo: "0+",
  alergias: "Ninguna",
  medicacion_habitual: "Ninguna",
  obra_social: "OSDE",
  numero_afiliado: "123",
  emergencia_nombre: "Contacto",
  emergencia_parentesco: "Madre",
  emergencia_domicilio: "Calle 2",
  emergencia_telefono: "11 5555-6666",
};
const laborales = (numero: string, fecha_ingreso: string) => ({
  numero_legajo: numero,
  area: "Operaciones",
  puesto: "Chofer",
  fecha_ingreso,
  estado_laboral: "activo" as const,
  sede: "San Martín",
  modalidad: "Presencial",
  convenio: "Camioneros",
  bruto_mensual: 1000,
});

// The day after today in Argentina (YYYY-MM-DD).
function mananaEnArgentina(): string {
  const [y, m, d] = hoyEnArgentina().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

describe("validation at the server boundary (GAP-07)", () => {
  const service = serviceClient();
  let empleado: TestUser;
  let admin: TestUser;
  let legajoId: string;
  const run = Date.now();

  function as(user: TestUser, role: "empleado" | "admin") {
    session.client = user.client;
    session.user = { id: user.id, email: user.email, role, cuenta: ACTIVA };
  }
  const legajo = async () => (await service.from("legajos").select("*").eq("id", legajoId).single()).data!;
  const solicitudes = async () =>
    (await service.from("solicitudes_cambio").select("id", { count: "exact" }).eq("legajo_id", legajoId)).count;

  beforeAll(async () => {
    empleado = await createTestUser(service, "validacion-empleado");
    admin = await createTestUser(service, "validacion-admin", "admin");
    legajoId = await legajoIdDe(service, empleado.id);
    await service
      .from("legajos")
      .update({ ...GRUPO_B, piso_depto: null, ...GRUPO_D, ...laborales(`V-${run}`, "2020-01-01") })
      .eq("id", legajoId);
  }, 60_000);

  beforeEach(async () => {
    await service.from("solicitudes_cambio").delete().eq("legajo_id", legajoId);
  });

  afterAll(async () => {
    session.client = null;
    session.user = null;
    await deleteTestUsers(service, [empleado.id, admin.id]);
  });

  // Each field: the group, the rejected values with their message, the
  // accepted boundary value.
  const casos = [
    {
      campo: "email_personal",
      grupo: "B",
      base: GRUPO_B,
      invalidos: ["no-es-un-email", "sin@dominio", "a@b.", "  "],
      mensaje: (valor: string) => (valor.trim() ? v.emailInvalid : v.required),
      valido: "nuevo.contacto@example.test",
    },
    {
      campo: "emergencia_telefono",
      grupo: "D",
      base: GRUPO_D,
      // 7 characters (one short), 21 (one long), letters, a "+" not leading.
      invalidos: ["1234567", "123456789012345678901", "11 5555-abcd", "11+55556666"],
      mensaje: () => v.telefonoInvalid,
      // Exactly 8 characters.
      valido: "12345678",
    },
  ] as const;

  for (const caso of casos) {
    describe(caso.campo, () => {
      it("an Empleado's change request with an invalid value is refused; nothing is stored", async () => {
        as(empleado, "empleado");
        const antes = await legajo();
        for (const valor of caso.invalidos) {
          const result = await miLegajo.enviarSolicitud({ grupo: caso.grupo, valores: { ...caso.base, [caso.campo]: valor } });
          expect(result, valor).toEqual(rechazo(caso.campo, caso.mensaje(valor)));
        }
        expect(await solicitudes()).toBe(0);
        expect(await legajo()).toEqual(antes);
      });

      it("an Admin's direct edit with an invalid value is refused; the legajo is unchanged", async () => {
        as(admin, "admin");
        const antes = await legajo();
        for (const valor of caso.invalidos) {
          const result = await legajos.actualizarGrupoLegajo({
            profileId: empleado.id,
            grupo: caso.grupo,
            valores: { ...caso.base, [caso.campo]: valor },
          });
          expect(result, valor).toEqual(rechazo(caso.campo, caso.mensaje(valor)));
        }
        expect(await legajo()).toEqual(antes);
      });

      it("the boundary value is accepted, as a request and as a direct edit", async () => {
        as(empleado, "empleado");
        expect(await miLegajo.enviarSolicitud({ grupo: caso.grupo, valores: { ...caso.base, [caso.campo]: caso.valido } })).toEqual({
          ok: true,
        });
        const { data: items } = await service
          .from("solicitudes_cambio_items")
          .select("campo, valor_propuesto, solicitudes_cambio!inner(legajo_id)")
          .eq("solicitudes_cambio.legajo_id", legajoId);
        expect(items?.map((item) => [item.campo, item.valor_propuesto])).toEqual([[caso.campo, caso.valido]]);

        // The request is resolved first (the Admin edit is locked meanwhile).
        await service.from("solicitudes_cambio").delete().eq("legajo_id", legajoId);
        as(admin, "admin");
        expect(
          await legajos.actualizarGrupoLegajo({ profileId: empleado.id, grupo: caso.grupo, valores: { ...caso.base, [caso.campo]: caso.valido } }),
        ).toEqual({ ok: true });
        expect((await legajo())[caso.campo]).toBe(caso.valido);
        // Back to the base value for the next case.
        await service.from("legajos").update({ [caso.campo]: caso.base[caso.campo as keyof typeof caso.base] }).eq("id", legajoId);
      });
    });
  }

  describe("fecha_ingreso", () => {
    it("an Admin's group E edit with a future date is refused; the legajo is unchanged", async () => {
      as(admin, "admin");
      const antes = await legajo();
      for (const fecha of [mananaEnArgentina(), "2999-01-01"]) {
        const result = await legajos.actualizarDatosLaborales({ profileId: empleado.id, valores: laborales(`V-${run}`, fecha) });
        expect(result, fecha).toEqual(rechazo("fecha_ingreso", v.fechaFutura));
      }
      expect(await legajo()).toEqual(antes);
    });

    it("today in Argentina is accepted", async () => {
      as(admin, "admin");
      const hoy = hoyEnArgentina();
      expect(await legajos.actualizarDatosLaborales({ profileId: empleado.id, valores: laborales(`V-${run}`, hoy) })).toEqual({ ok: true });
      expect((await legajo()).fecha_ingreso).toBe(hoy);
    });
  });
});
