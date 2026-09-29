import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analizarPrograma, crearPrograma, inventarioAcciones, problema, SRC } from "./acciones-inventario.test-helpers";

// Action inventory (PRD session rules, AUD10-03). How it works is described
// in ./acciones-inventario.test-helpers.ts.

describe("Server Action inventory", () => {
  const acciones = inventarioAcciones();

  it("finds every action", () => {
    expect(acciones.length).toBeGreaterThanOrEqual(30);
    expect(acciones.map((a) => a.clave)).toContain("lib/auth/actions.ts#cambiarPassword");
  });

  it("every action checks the session before any I/O, and exemptions stay where they are allowed", () => {
    expect(acciones.map(problema).filter(Boolean)).toEqual([]);
  });

  it("the three exemptions are in use exactly where named", () => {
    const usadas = acciones.filter((a) => a.resultado.estado === "ok" && a.resultado.exencion).map((a) => a.clave).sort();
    expect(usadas).toEqual(
      ["lib/auth/actions.ts#cambiarPassword", "lib/auth/actions.ts#cerrarSesionPorInactividad", "lib/auth/actions.ts#logout"].sort(),
    );
  });

  it("fails each broken fixture (self-test)", () => {
    const base = join(SRC, "__inventario__");
    const guardias = `import { autorizarAccion, sesionParaCerrar, sessionWithRole } from "@/lib/auth/require-role";\nimport { createClient } from "@/lib/supabase/server";\n`;
    const virtuales: Record<string, string> = {
      // Fine, for contrast.
      [join(base, "bien.ts")]: `"use server";\n${guardias}
        async function guard() { return sessionWithRole("admin"); }
        export async function directa() { if (!(await sessionWithRole("admin"))) return; const s = await createClient(); await s.from("x").select(); }
        export async function delegada() { return correr(); }
        async function correr() { if (!(await guard())) return; }`,
      [join(base, "sin-guardia.ts")]: `"use server";\n${guardias}
        export async function sinGuardia() { const s = await createClient(); await s.from("x").select(); }`,
      [join(base, "await-antes.ts")]: `"use server";\n${guardias}
        export async function awaitAntes() { await fetch("https://x.test"); await sessionWithRole("admin"); }`,
      [join(base, "sombra.ts")]: `"use server";\n${guardias.replace("sessionWithRole", "sessionWithRole as original")}
        async function sessionWithRole(_rol: string) { return true; }
        export async function sombra() { if (!(await sessionWithRole("admin"))) return; const s = await createClient(); await s.from("x").select(); }`,
      [join(base, "falso.ts")]: `export async function sessionWithRole(_rol: string) { return true; }`,
      [join(base, "importada.ts")]: `"use server";\nimport { sessionWithRole } from "./falso";\nimport { createClient } from "@/lib/supabase/server";
        export async function importada() { if (!(await sessionWithRole("admin"))) return; const s = await createClient(); await s.from("x").select(); }`,
      [join(base, "Componente.tsx")]: `import { createClient } from "@/lib/supabase/server";
        export function Componente() {
          async function inline() { "use server"; const s = await createClient(); await s.from("x").delete(); }
          return inline;
        }`,
      [join(base, "impl.ts")]: `import { createClient } from "@/lib/supabase/server";
        export async function reexportada() { const s = await createClient(); await s.rpc("x"); }`,
      [join(base, "reexporta.ts")]: `"use server";\nexport { reexportada } from "./impl";`,
      [join(base, "por-defecto.ts")]: `"use server";\nimport { createClient } from "@/lib/supabase/server";
        export default async function () { const s = await createClient(); await s.from("x").select(); }`,
      [join(base, "exencion.ts")]: `"use server";\n${guardias}
        export async function exencionAjena() { await autorizarAccion({ permitirCambioPendiente: true }); const s = await createClient(); await s.from("x").select(); }
        export async function cierreAjeno() { await sesionParaCerrar(); const s = await createClient(); await s.from("x").select(); }`,
    };
    const resultados = analizarPrograma(crearPrograma(virtuales), (archivo) => archivo.startsWith(base));
    const porClave = Object.fromEntries(resultados.map((a) => [a.clave.replace("__inventario__/", ""), problema(a)]));

    expect(porClave["bien.ts#directa"]).toBeNull();
    expect(porClave["bien.ts#delegada"]).toBeNull();
    // Each fails for the right reason.
    expect(porClave["reexporta.ts#reexportada"]).toContain("await s.rpc");
    expect(porClave["importada.ts#importada"]).toContain('await s.from("x").select');
    expect(porClave["sombra.ts#sombra"]).toContain('await s.from("x").select');
    expect(porClave["await-antes.ts#awaitAntes"]).toContain("await fetch");
    expect(porClave["por-defecto.ts#default"]).toContain('await s.from("x").select');
    expect(porClave["Componente.tsx#inline (inline)"]).toContain('await s.from("x").delete');
    expect(porClave["exencion.ts#exencionAjena"]).toContain("cambio-pendiente");
    expect(porClave["exencion.ts#cierreAjeno"]).toContain("cierre");
    for (const clave of [
      "sin-guardia.ts#sinGuardia",
      "await-antes.ts#awaitAntes",
      "sombra.ts#sombra",
      "importada.ts#importada",
      "Componente.tsx#inline (inline)",
      "reexporta.ts#reexportada",
      "por-defecto.ts#default",
      "exencion.ts#exencionAjena",
      "exencion.ts#cierreAjeno",
    ]) {
      expect(porClave[clave], clave).toEqual(expect.any(String));
    }
  });
});
