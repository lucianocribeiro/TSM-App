import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { legajoIdDe } from "./actores";
import { anonClient, createTestUser, deleteTestUsers, serviceClient, type TestUser } from "./helpers";
import { ACTORES_ROL, ejecutarCelda, OPS, TABLAS, type Llamante, type Titular } from "./matriz-acceso";

// F1-11A, GAP-02: the denied-operation matrix for the role actors (anon, an
// Empleado on their own and on another employee's data, an Admin), over
// every table and the legajo-docs bucket, SELECT/INSERT/UPDATE/DELETE. The
// expectations live in ./matriz-acceso.ts, next to the account-state actors
// (estado-cuenta-rls.test.ts). Every cell that is not "permitido" also
// proves the titular's data did not change.

describe("access matrix: role actors (GAP-02)", () => {
  const service = serviceClient();
  let empleado: TestUser;
  let victima: TestUser;
  let admin: TestUser;
  const titulares = new Map<string, Titular>();

  beforeAll(async () => {
    empleado = await createTestUser(service, "matriz-empleado");
    victima = await createTestUser(service, "matriz-victima");
    admin = await createTestUser(service, "matriz-admin", "admin");
    for (const user of [empleado, victima]) {
      titulares.set(user.id, { id: user.id, legajoId: await legajoIdDe(service, user.id) });
    }
  }, 60_000);

  afterAll(async () => {
    await deleteTestUsers(service, [empleado.id, victima.id, admin.id]);
  });

  function actor(nombre: (typeof ACTORES_ROL)[number]): { llamante: Llamante; titular: Titular } {
    const de = (user: TestUser) => titulares.get(user.id)!;
    switch (nombre) {
      case "anon":
        return { llamante: { cliente: anonClient(), id: null }, titular: de(victima) };
      case "empleado-propio":
        return { llamante: { cliente: empleado.client, id: empleado.id }, titular: de(empleado) };
      case "empleado-ajeno":
        return { llamante: { cliente: empleado.client, id: empleado.id }, titular: de(victima) };
      case "admin":
        return { llamante: { cliente: admin.client, id: admin.id }, titular: de(victima) };
    }
  }

  for (const [tabla, espec] of Object.entries(TABLAS)) {
    describe(tabla, () => {
      for (const nombre of ACTORES_ROL) {
        for (const op of OPS) {
          const esperado = espec.esperado[nombre][op];
          it(`${nombre} ${op}: ${esperado}`, async () => {
            const { llamante, titular } = actor(nombre);
            const { resultado, antes, despues } = await ejecutarCelda(service, espec, op, llamante, titular);
            expect(resultado).toBe(esperado);
            if (esperado !== "permitido") expect(despues).toEqual(antes);
          });
        }
      }
    });
  }
});
