import { beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/copy/es-AR";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const { login, logout } = await import("./actions");

const INVALID = { ok: false, error: copy.auth.errors.invalidCredentials };
const LOGOUT_FAILED = { ok: false, error: copy.auth.errors.logoutFailed };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function authClient(auth: Record<string, unknown>) {
  return { auth };
}

beforeEach(() => {
  mocks.createClient.mockReset();
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
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue(authClient({ signInWithPassword }));
    await expect(login(null, form({ email: "ana@mitsm.test", password: "secret" }))).rejects.toThrow(
      "NEXT_REDIRECT:/mi-legajo",
    );
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
