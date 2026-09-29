import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { clasificarRuta, RUTAS } from "./rutas";

// Every page and route handler under src/app must have an entry in the route
// map, and every entry must have one: a new page cannot ship unclassified.

const APP = join(process.cwd(), "src", "app");

function archivosDeRuta(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosDeRuta(ruta);
    return /^(page|route)\.(tsx?|jsx?)$/.test(nombre) ? [ruta] : [];
  });
}

// src/app/(app)/legajos/[id]/page.tsx -> /legajos/[id]; route groups do not count.
function patronDe(archivo: string): string {
  const segmentos = relative(APP, archivo)
    .split(sep)
    .slice(0, -1)
    .filter((segmento) => !/^\(.*\)$/.test(segmento));
  return `/${segmentos.join("/")}`;
}

describe("route map", () => {
  const patrones = archivosDeRuta(APP).map(patronDe).sort();
  const mapeados = RUTAS.map((ruta) => ruta.patron as string).sort();

  it("finds the app's pages", () => {
    expect(patrones.length).toBeGreaterThan(10);
    expect(patrones).toContain("/aprobaciones/solicitudes/[id]");
  });

  it("classifies every page and route handler, and lists nothing that does not exist", () => {
    expect(mapeados).toEqual(patrones);
  });

  it("fails for an unmapped page (the check the test above relies on)", () => {
    const conNueva = [...patrones, "/reportes"].sort();
    expect(mapeados).not.toEqual(conNueva);
    expect(clasificarRuta("/reportes")).toBeNull();
  });

  it("classifies paths", () => {
    expect(clasificarRuta("/login")).toBe("publica");
    expect(clasificarRuta("/auth/salir")).toBe("publica");
    expect(clasificarRuta("/")).toBe("autenticada");
    expect(clasificarRuta("/mi-legajo")).toBe("autenticada");
    expect(clasificarRuta("/cambiar-password")).toBe("autenticada");
    for (const path of ["/legajos", "/legajos/", "/legajos/x", "/usuarios/x", "/aprobaciones/documentos/x", "/aprobaciones/otra/cosa"]) {
      expect(clasificarRuta(path), path).toBe("admin");
    }
    // Default deny: anything else, including near misses.
    for (const path of ["/legajos-x", "/mi-legajo/x", "/Login", "/login/x", "/api/x", "/aprobaciones-x"]) {
      expect(clasificarRuta(path), path).toBeNull();
    }
  });
});
