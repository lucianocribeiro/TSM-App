import { beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  verifyCurrentPassword: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./verify-password", () => ({ verifyCurrentPassword: mocks.verifyCurrentPassword }));

const { cambiarPassword, login, logout } = await import("./actions");

const INVALID = { ok: false, error: copy.auth.errors.invalidCredentials };
const INACTIVE = { ok: false, error: copy.auth.errors.cuentaInactiva };
const LOGOUT_FAILED = { ok: false, error: copy.auth.errors.logoutFailed };
const passwordErrors = copy.password.errors;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function authClient(auth: Record<string, unknown>) {
  return { auth };
}

type Profile = { estado_cuenta: "activa" | "inactiva"; debe_cambiar_password: boolean } | null;

// A client whose sign-in succeeds and whose own profile read returns `profile`.
function signedInClient(profile: Profile, profileError: unknown = null) {
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: profile, error: profileError });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const signInWithPassword = vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  return { client: { auth: { signInWithPassword, signOut }, from }, signOut, from, eq };
}

beforeEach(() => {
  mocks.createClient.mockReset();
  mocks.verifyCurrentPassword.mockReset();
  mocks.redirect.mockClear();
});

describe("login", () => {
  it.each([
    ["empty email", { email: "", password: "secret" }],
    ["empty password", { email: "ana@mitsm.test", password: "" }],
    ["malformed email", { email: "not-an-email", password: "secret" }],
  ])("returns the generic error for %s without calling Supabase", async (_label, fields) => {
    await expect(login(null, form(fields))).resolves.toEqual(INVALID);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("returns the generic error when Supabase rejects the credentials", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: { code: "invalid_credentials" } });
    mocks.createClient.mockResolvedValue(authClient({ signInWithPassword }));

    await expect(login(null, form({ email: "ana@mitsm.test", password: "wrong" }))).resolves.toEqual(INVALID);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "ana@mitsm.test", password: "wrong" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns the generic error when client creation throws", async () => {
    mocks.createClient.mockRejectedValue(new Error("boom"));
    await expect(login(null, form({ email: "ana@mitsm.test", password: "secret" }))).resolves.toEqual(INVALID);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns the generic error when signInWithPassword throws", async () => {
    const signInWithPassword = vi.fn().mockRejectedValue(new Error("network down"));
    mocks.createClient.mockResolvedValue(authClient({ signInWithPassword }));
    await expect(login(null, form({ email: "ana@mitsm.test", password: "secret" }))).resolves.toEqual(INVALID);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects to /mi-legajo on success, outside the try/catch", async () => {
    const { client, from, eq } = signedInClient({ estado_cuenta: "activa", debe_cambiar_password: false });
    mocks.createClient.mockResolvedValue(client);
    await expect(login(null, form({ email: "ana@mitsm.test", password: "secret" }))).rejects.toThrow(
      "NEXT_REDIRECT:/mi-legajo",
    );
    expect(from).toHaveBeenCalledWith("profiles");
    expect(eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("redirects to /cambiar-password when the password is temporary", async () => {
    const { client } = signedInClient({ estado_cuenta: "activa", debe_cambiar_password: true });
    mocks.createClient.mockResolvedValue(client);
    await expect(login(null, form({ email: "ana@mitsm.test", password: "secret" }))).rejects.toThrow(
      "NEXT_REDIRECT:/cambiar-password",
    );
  });

  it("signs an inactive account out and returns the inactive-account message", async () => {
    const { client, signOut } = signedInClient({ estado_cuenta: "inactiva", debe_cambiar_password: false });
    mocks.createClient.mockResolvedValue(client);
    await expect(login(null, form({ email: "ana@mitsm.test", password: "secret" }))).resolves.toEqual(INACTIVE);
    expect(signOut).toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns the inactive-account message for a banned account", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ data: {}, error: { code: "user_banned" } });
    mocks.createClient.mockResolvedValue(authClient({ signInWithPassword }));
    await expect(login(null, form({ email: "ana@mitsm.test", password: "secret" }))).resolves.toEqual(INACTIVE);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("signs out and returns the generic error when the profile cannot be read", async () => {
    const { client, signOut } = signedInClient(null, { code: "x" });
    mocks.createClient.mockResolvedValue(client);
    await expect(login(null, form({ email: "ana@mitsm.test", password: "secret" }))).resolves.toEqual(INVALID);
    expect(signOut).toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("cambiarPassword", () => {
  // A signed-in user whose profile says whether the change is forced.
  function passwordClient({
    debe,
    updateError = null,
    confirmError = null,
  }: {
    debe: boolean;
    updateError?: unknown;
    confirmError?: unknown;
  }) {
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "ana@mitsm.test" } }, error: null });
    const updateUser = vi.fn().mockResolvedValue({ data: {}, error: updateError });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: confirmError });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { debe_cambiar_password: debe }, error: null });
    const from = vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) }));
    mocks.createClient.mockResolvedValue({ auth: { getUser, updateUser }, rpc, from });
    return { updateUser, rpc };
  }

  const nueva = { password: "NuevaClave-1", confirmacion: "NuevaClave-1" };
  const generic = { ok: false, error: passwordErrors.guardarFallo };

  describe("forced change", () => {
    it("validates the two fields and does not ask for the current password", async () => {
      const { updateUser } = passwordClient({ debe: true });
      await expect(cambiarPassword(null, form({ password: "corta", confirmacion: "corta" }))).resolves.toEqual({
        ok: false,
        error: passwordErrors.demasiadoCorta,
      });
      await expect(
        cambiarPassword(null, form({ password: "NuevaClave-1", confirmacion: "OtraClave-1" })),
      ).resolves.toEqual({ ok: false, error: passwordErrors.noCoinciden });
      expect(updateUser).not.toHaveBeenCalled();
      expect(mocks.verifyCurrentPassword).not.toHaveBeenCalled();
    });

    it("updates the password, confirms the change and redirects to /mi-legajo", async () => {
      const { updateUser, rpc } = passwordClient({ debe: true });
      await expect(cambiarPassword(null, form(nueva))).rejects.toThrow("NEXT_REDIRECT:/mi-legajo");
      expect(mocks.verifyCurrentPassword).not.toHaveBeenCalled();
      expect(updateUser).toHaveBeenCalledWith({ password: "NuevaClave-1" });
      expect(rpc).toHaveBeenCalledWith("confirmar_cambio_password");
    });

    it("asks for a different password when it equals the current one", async () => {
      const { rpc } = passwordClient({ debe: true, updateError: { code: "same_password" } });
      await expect(cambiarPassword(null, form(nueva))).resolves.toEqual({
        ok: false,
        error: passwordErrors.igualActual,
      });
      expect(rpc).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
    });
  });

  describe("voluntary change", () => {
    it("requires the current password before anything else", async () => {
      const { updateUser } = passwordClient({ debe: false });
      await expect(cambiarPassword(null, form(nueva))).resolves.toEqual({
        ok: false,
        error: passwordErrors.actualRequerida,
      });
      expect(mocks.verifyCurrentPassword).not.toHaveBeenCalled();
      expect(updateUser).not.toHaveBeenCalled();
    });

    it("changes nothing when the current password is wrong", async () => {
      const { updateUser, rpc } = passwordClient({ debe: false });
      mocks.verifyCurrentPassword.mockResolvedValue(false);
      await expect(cambiarPassword(null, form({ ...nueva, actual: "Equivocada-1" }))).resolves.toEqual({
        ok: false,
        error: passwordErrors.actualIncorrecta,
      });
      expect(mocks.verifyCurrentPassword).toHaveBeenCalledWith("ana@mitsm.test", "Equivocada-1");
      expect(updateUser).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });

    it("updates the password after verifying the current one", async () => {
      const { updateUser, rpc } = passwordClient({ debe: false });
      mocks.verifyCurrentPassword.mockResolvedValue(true);
      await expect(cambiarPassword(null, form({ ...nueva, actual: "ClaveActual-1" }))).rejects.toThrow(
        "NEXT_REDIRECT:/mi-legajo",
      );
      expect(mocks.verifyCurrentPassword).toHaveBeenCalledWith("ana@mitsm.test", "ClaveActual-1");
      expect(updateUser).toHaveBeenCalledWith({ password: "NuevaClave-1" });
      expect(rpc).toHaveBeenCalledWith("confirmar_cambio_password");
    });
  });

  it("returns the generic error when the session, profile, update or confirmation fails, or anything throws", async () => {
    passwordClient({ debe: true, updateError: { code: "unexpected" } });
    await expect(cambiarPassword(null, form(nueva))).resolves.toEqual(generic);
    passwordClient({ debe: true, confirmError: { code: "P0002" } });
    await expect(cambiarPassword(null, form(nueva))).resolves.toEqual(generic);

    const noUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { code: "x" } });
    mocks.createClient.mockResolvedValue({ auth: { getUser: noUser } });
    await expect(cambiarPassword(null, form(nueva))).resolves.toEqual(generic);

    mocks.createClient.mockRejectedValue(new Error("boom"));
    await expect(cambiarPassword(null, form(nueva))).resolves.toEqual(generic);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("logout", () => {
  it("returns the generic logout error when signOut fails", async () => {
    mocks.createClient.mockResolvedValue(authClient({ signOut: vi.fn().mockResolvedValue({ error: { code: "x" } }) }));
    await expect(logout()).resolves.toEqual(LOGOUT_FAILED);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns the generic logout error when client creation throws", async () => {
    mocks.createClient.mockRejectedValue(new Error("boom"));
    await expect(logout()).resolves.toEqual(LOGOUT_FAILED);
  });

  it("returns the generic logout error when signOut throws", async () => {
    mocks.createClient.mockResolvedValue(authClient({ signOut: vi.fn().mockRejectedValue(new Error("network down")) }));
    await expect(logout()).resolves.toEqual(LOGOUT_FAILED);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects to /login on success", async () => {
    mocks.createClient.mockResolvedValue(authClient({ signOut: vi.fn().mockResolvedValue({ error: null }) }));
    await expect(logout()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
