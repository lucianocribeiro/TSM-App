import { describe, expect, it, vi } from "vitest";
import { copyRecibos } from "@/lib/copy/recibos";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/cuentas", () => ({ listarCuentas: async () => ({ ok: true, data: [] }) }));

const { nombreVisible, ordenarPersonas } = await import("./carga-datos");

// Invented names only.
const persona = (id: string, nombres: string | null, apellido: string | null, email: string | null = null) => ({ id, nombres, apellido, email });

describe("Carga de recibos rows", () => {
  it("sorts by surname, then first names, accents ignored; people without a name go last", () => {
    const filas = [
      persona("1", "Zoe", "Ñandú"),
      persona("2", "Ana", "Álvarez"),
      persona("3", null, null, "sin.nombre@mitsm.test"),
      persona("4", "Bruno", "Alvarez"),
      persona("5", "Carla", "Benítez"),
    ];
    expect(ordenarPersonas(filas).map((p) => p.id)).toEqual(["2", "4", "5", "1", "3"]);
  });

  it("shows the name, else the email, else the fallback; never an id", () => {
    expect(nombreVisible(persona("x", "Ana", "Pérez"))).toBe("Ana Pérez");
    expect(nombreVisible(persona("x", null, null, "ana@mitsm.test"))).toBe("ana@mitsm.test");
    expect(nombreVisible(persona("x", " ", null, ""))).toBe(copyRecibos.usuarioNoDisponible);
  });
});
