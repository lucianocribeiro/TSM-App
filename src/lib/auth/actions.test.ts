import { beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  verifyCurrentPassword: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  sellarActividad: vi.fn(),
  borrarActividad: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./verify-password", () => ({ verifyCurrentPassword: mocks.verifyCurrentPassword }));
vi.mock("@/lib/sesion/marca-servidor", () => ({
  sellarActividad: mocks.sellarActividad,
  borrarActividad: mocks.borrarActividad,
}));
vi.mock("./session", () => ({ getSessionUser: mocks.getSessionUser }));

const { cambiarPassword, cerrarSesionPorInactividad, login, logout, mantenerSesion } = await import("./actions");

const SESION_ID = "7c0ffee0-1234-4abc-8def-0123456789ab";
// An access token whose payload carries the session id (not verified here:
// the Auth server has just issued it).
function token(payload: Record<string, unknown>) {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "ES256" })}.${b64(payload)}.firma`;
}

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
  const signInWithPassword = vi.fn().mockResolvedValue({
    data: { user: { id: "user-1" }, session: { access_token: token({ sub: "user-1", session_id: SESION_ID }) } },
    error: null,
  });
  return { client: { auth: { signInWithPassword, signOut }, from }, signOut, from, eq, signInWithPassword };
}

beforeEach(() => {
  mocks.createClient.mockReset();
  mocks.verifyCurrentPassword.mockReset();
  mocks.redirect.mockClear();
  mocks.sellarActividad.mockReset().mockResolvedValue(true);
  mocks.borrarActividad.mockReset().mockResolvedValue(undefined);
  mocks.getSessionUser.mockReset();
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
    // The activity marker starts with the session.
    expect(mocks.sellarActividad).toHaveBeenCalledWith(SESION_ID);
  });

  it("returns to a safe ?volver= route after signing in, and ignores an unsafe one", async () => {
    for (const [volver, destino] of [
      ["/legajos/abc?x=1", "/legajos/abc?x=1"],
      ["/aprobaciones", "/aprobaciones"],
      ["https://evil.example/legajos", "/mi-legajo"],
      ["//evil.example", "/mi-legajo"],
      ["/%2F%2Fevil.example", "/mi-legajo"],
      ["/login", "/mi-legajo"],
    ]) {
      mocks.redirect.mockClear();
      const { client } = signedInClient({ estado_cuenta: "activa", debe_cambiar_password: false });
      mocks.createClient.mockResolvedValue(client);
      await expect(login(null, form({ email: "ana@mitsm.test", password: "secret", volver })), volver).rejects.toThrow(
        `NEXT_REDIRECT:${destino}`,
      );
    }
  });

  it("a pending password change wins over ?volver=", async () => {
    const { client } = signedInClient({ estado_cuenta: "activa", debe_cambiar_password: true });
    mocks.createClient.mockResolvedValue(client);
    await expect(login(null, form({ email: "ana@mitsm.test", password: "secret", volver: "/legajos" }))).rejects.toThrow(
      "NEXT_REDIRECT:/cambiar-password",
    );
  });

  it("fails closed when the activity marker cannot be signed (no usable SESSION_SECRET)", async () => {
    const { client, signOut } = signedInClient({ estado_cuenta: "activa", debe_cambiar_password: false });
    mocks.createClient.mockResolvedValue(client);
    mocks.sellarActividad.mockResolvedValue(false);
    await expect(login(null, form({ email: "ana@mitsm.test", password: "secret" }))).resolves.toEqual(INVALID);
    expect(signOut).toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("signs out when the new session has no id to bind the activity marker to", async () => {
    const { client, signOut, signInWithPassword } = signedInClient({ estado_cuenta: "activa", debe_cambiar_password: false });
    signInWithPassword.mockResolvedValue({ data: { user: { id: "user-1" }, session: { access_token: token({ sub: "user-1" }) } }, error: null });
    mocks.createClient.mockResolvedValue(client);
    await expect(login(null, form({ email: "ana@mitsm.test", password: "secret" }))).resolves.toEqual(INVALID);
    expect(signOut).toHaveBeenCalled();
    expect(mocks.sellarActividad).not.toHaveBeenCalled();
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
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: token({ sub: "user-1", session_id: SESION_ID }) } },
      error: null,
    });
    mocks.createClient.mockResolvedValue({ auth: { getUser, updateUser, getSession }, rpc, from });
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
      expect(mocks.sellarActividad).toHaveBeenCalledWith(SESION_ID);
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

  it("redirects to /login on success, clearing the activity marker", async () => {
    mocks.createClient.mockResolvedValue(authClient({ signOut: vi.fn().mockResolvedValue({ error: null }) }));
    await expect(logout()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.borrarActividad).toHaveBeenCalled();
  });
});

describe("inactivity actions", () => {
  it("mantenerSesion answers ok only for an active signed-in user", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u", email: "", role: "empleado", cuenta: { estadoCuenta: "activa", debeCambiarPassword: false } });
    await expect(mantenerSesion()).resolves.toEqual({ ok: true });
    mocks.getSessionUser.mockResolvedValue(null);
    await expect(mantenerSesion()).resolves.toEqual({ ok: false, error: copy.auth.errors.sesionInactividad });
    mocks.getSessionUser.mockResolvedValue({ id: "u", email: "", role: "admin", cuenta: { estadoCuenta: "inactiva", debeCambiarPassword: false } });
    expect((await mantenerSesion()).ok).toBe(false);
  });

  it("cerrarSesionPorInactividad signs out, clears the marker and shows the reason, even if signOut fails", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue(authClient({ signOut }));
    await expect(cerrarSesionPorInactividad()).rejects.toThrow("NEXT_REDIRECT:/login?sesion=inactividad");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.borrarActividad).toHaveBeenCalled();

    mocks.createClient.mockRejectedValue(new Error("boom"));
    await expect(cerrarSesionPorInactividad()).rejects.toThrow("NEXT_REDIRECT:/login?sesion=inactividad");
  });
});
