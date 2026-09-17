import { describe, expect, it } from "vitest";
import { parseLoginInput } from "./login-input";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("parseLoginInput", () => {
  it("returns trimmed credentials for valid input", () => {
    expect(parseLoginInput(form({ email: "  ana@mitsm.test ", password: "secret" }))).toEqual({
      email: "ana@mitsm.test",
      password: "secret",
    });
  });

  it("rejects missing, empty or malformed values", () => {
    expect(parseLoginInput(new FormData())).toBeNull();
    expect(parseLoginInput(form({ email: "", password: "secret" }))).toBeNull();
    expect(parseLoginInput(form({ email: "   ", password: "secret" }))).toBeNull();
    expect(parseLoginInput(form({ email: "ana@mitsm.test", password: "" }))).toBeNull();
    expect(parseLoginInput(form({ email: "not-an-email", password: "secret" }))).toBeNull();
    expect(parseLoginInput(form({ email: "ana@mitsm", password: "secret" }))).toBeNull();
  });
});
