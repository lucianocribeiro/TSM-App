import { describe, expect, it } from "vitest";
import { passwordSchema } from "@/lib/auth/password";
import { GENERATED_PASSWORD_LENGTH, generarPasswordTemporal } from "./generar-password";

describe("generarPasswordTemporal", () => {
  it("meets the shared password rules, with every character class", () => {
    for (let i = 0; i < 200; i += 1) {
      const password = generarPasswordTemporal();
      expect(password).toHaveLength(GENERATED_PASSWORD_LENGTH);
      expect(passwordSchema.safeParse(password).success).toBe(true);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[2-9]/);
      expect(password).toMatch(/[-_.!?]/);
    }
  });

  it("never uses look-alike characters", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generarPasswordTemporal()).not.toMatch(/[0O1lI]/);
    }
  });

  it("never goes below the minimum length", () => {
    expect(generarPasswordTemporal(4)).toHaveLength(8);
  });

  it("is random", () => {
    const values = new Set(Array.from({ length: 50 }, () => generarPasswordTemporal()));
    expect(values.size).toBe(50);
  });
});
