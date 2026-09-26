import { describe, expect, it } from "vitest";
import { anonClient } from "./helpers";

// Verifies the local seed (supabase/seed.sql): test users sign in with email +
// password and carry the expected roles. Local and CI test data only.
const SEED_PASSWORD = "TestPass123!";

const seedUsers = [
  { email: "admin@mitsm.test", role: "admin" },
  { email: "empleado.a@mitsm.test", role: "empleado" },
  { email: "empleado.b@mitsm.test", role: "empleado" },
] as const;

describe("local seed users", () => {
  for (const { email, role } of seedUsers) {
    it(`${email} signs in with role ${role}`, async () => {
      const client = anonClient();
      const { error } = await client.auth.signInWithPassword({
        email,
        password: SEED_PASSWORD,
      });
      expect(error).toBeNull();

      const { data, error: rpcError } = await client.rpc("current_app_role");
      expect(rpcError).toBeNull();
      expect(data).toBe(role);

      await client.auth.signOut();
    });
  }
});

describe("local seed accounts", () => {
  it("empleado.inactivo@mitsm.test cannot sign in: the account is banned", async () => {
    const client = anonClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: "empleado.inactivo@mitsm.test",
      password: SEED_PASSWORD,
    });
    expect(data.session).toBeNull();
    expect(error?.code).toBe("user_banned");
  });

  it("the inactive account is inactive, with a deactivation event and its reason", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: "admin@mitsm.test", password: SEED_PASSWORD });
    const { data: profile } = await client
      .from("profiles")
      .select("estado_cuenta, debe_cambiar_password")
      .eq("id", "00000000-0000-4000-a000-000000000004")
      .single();
    expect(profile).toEqual({ estado_cuenta: "inactiva", debe_cambiar_password: false });

    const { data: events } = await client
      .from("cuenta_eventos")
      .select("tipo, motivo, actor_id")
      .eq("profile_id", "00000000-0000-4000-a000-000000000004");
    expect(events).toEqual([
      {
        tipo: "desactivacion",
        motivo: expect.stringMatching(/\S/),
        actor_id: "00000000-0000-4000-a000-000000000001",
      },
    ]);
    await client.auth.signOut();
  });

  it("Empleado B must change the password; Admin and Empleado A need not", async () => {
    const expected = [
      ["admin@mitsm.test", false],
      ["empleado.a@mitsm.test", false],
      ["empleado.b@mitsm.test", true],
    ] as const;
    for (const [email, debe] of expected) {
      const client = anonClient();
      const { data: auth } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
      const { data } = await client
        .from("profiles")
        .select("estado_cuenta, debe_cambiar_password")
        .eq("id", auth.user?.id ?? "")
        .single();
      expect(data, email).toEqual({ estado_cuenta: "activa", debe_cambiar_password: debe });
      await client.auth.signOut();
    }
  });
});

describe("local seed documents", () => {
  async function signIn(email: string) {
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
    expect(error).toBeNull();
    return client;
  }

  it("Empleado A has approved DNI frente and dorso with readable fake files", async () => {
    const client = await signIn("empleado.a@mitsm.test");
    const { data, error } = await client
      .from("legajo_documentos")
      .select("tipo, estado, storage_path, size_bytes")
      .order("tipo");
    expect(error).toBeNull();
    expect(data?.map((row) => row.tipo)).toEqual(["dni_frente", "dni_dorso"]);
    expect(data?.map((row) => row.estado)).toEqual(["aprobado", "aprobado"]);

    for (const row of data ?? []) {
      const file = await client.storage.from("legajo-docs").download(row.storage_path);
      expect(file.error, row.tipo).toBeNull();
      const text = (await file.data?.text()) ?? "";
      expect(text, row.tipo).toContain("FAKE TEST FILE");
      expect(file.data?.size, row.tipo).toBe(row.size_bytes);
    }
    await client.auth.signOut();
  });

  // F1-06B: was "Empleado B has no documents"; the seed now gives B one
  // pending document to exercise the approval flow.
  it("Empleado B has one pending licencia de conducir with a readable fake file", async () => {
    const client = await signIn("empleado.b@mitsm.test");
    const { data, error } = await client
      .from("legajo_documentos")
      .select("tipo, estado, storage_path, size_bytes");
    expect(error).toBeNull();
    expect(data?.map(({ tipo, estado }) => ({ tipo, estado }))).toEqual([
      { tipo: "licencia_conducir", estado: "pendiente" },
    ]);
    const row = data?.[0];
    const file = await client.storage.from("legajo-docs").download(row?.storage_path ?? "");
    expect(file.error).toBeNull();
    expect(await file.data?.text()).toContain("FAKE TEST FILE");
    expect(file.data?.size).toBe(row?.size_bytes);
    await client.auth.signOut();
  });
});

describe("local seed change requests", () => {
  async function signIn(email: string) {
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
    expect(error).toBeNull();
    return client;
  }

  it("Empleado A has one pending request with two fields and one rejected request with a reason", async () => {
    const client = await signIn("empleado.a@mitsm.test");
    const { data, error } = await client
      .from("solicitudes_cambio")
      .select("estado, motivo_rechazo, revisado_por, solicitudes_cambio_items (campo, valor_propuesto, valor_anterior)")
      .order("created_at");
    expect(error).toBeNull();
    expect(data?.map((row) => row.estado)).toEqual(["rechazada", "pendiente"]);

    const [rechazada, pendiente] = data ?? [];
    expect(rechazada.motivo_rechazo?.trim()).toBeTruthy();
    expect(rechazada.revisado_por).not.toBeNull();
    expect(rechazada.solicitudes_cambio_items).toHaveLength(1);

    const items = [...pendiente.solicitudes_cambio_items].sort((a, b) => a.campo.localeCompare(b.campo));
    expect(items).toEqual([
      { campo: "alergias", valor_propuesto: "Polen y ácaros (dato de prueba)", valor_anterior: "Polen (dato de prueba)" },
      { campo: "telefono_celular", valor_propuesto: "1100000022", valor_anterior: "1100000002" },
    ]);
    await client.auth.signOut();
  });

  it("Empleado B has no change requests", async () => {
    const client = await signIn("empleado.b@mitsm.test");
    const { data, error } = await client.from("solicitudes_cambio").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    await client.auth.signOut();
  });

  it("the Admin sees one pending request and one pending document", async () => {
    const client = await signIn("admin@mitsm.test");
    const { data, error } = await client.rpc("pendientes_admin").single();
    expect(error).toBeNull();
    expect(data).toEqual({ solicitudes: 1, documentos: 1 });
    await client.auth.signOut();
  });
});
