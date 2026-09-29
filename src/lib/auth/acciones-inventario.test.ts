import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Action inventory (PRD session rules, AUD10-03): every Server Action checks
// the session, role and account state before any I/O, through the central
// helpers of src/lib/auth/require-role.ts.
//
// How it works, with the TypeScript type checker over the whole of src:
// - Actions: every export of a module whose first statement is "use server"
//   (re-exports and default exports resolved to their implementation), and
//   every function anywhere whose body starts with "use server" (inline).
// - For each action, statements are walked in source order (closures, which
//   run later, are skipped). The first awaited call must resolve, by symbol,
//   to one of the guard helpers declared in require-role.ts; a same-named
//   function declared anywhere else does not count. A call to another
//   function of the project (awaited or returned, e.g. `return run(...)`) is
//   followed into its declaration. createClient (src/lib/supabase/server.ts)
//   only builds the client and is skipped. Anything else first fails.
// - Exemptions are explicit at the call site and allowed only where named:
//   autorizarAccion({ permitirCambioPendiente: true }) in cambiarPassword,
//   and sesionParaCerrar() in logout and cerrarSesionPorInactividad. login
//   runs before there is a session and is the one public action.

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const GUARDIAS_ARCHIVO = join(SRC, "lib", "auth", "require-role.ts");
const GUARDIAS = new Set(["autorizarAccion", "sessionWithRole", "usuarioActivo", "sesionParaCerrar"]);
const NEUTRAS: [string, string][] = [[join(SRC, "lib", "supabase", "server.ts"), "createClient"]];

type Exencion = "cambio-pendiente" | "cierre";
const EXENCIONES_PERMITIDAS: Record<Exencion, Set<string>> = {
  "cambio-pendiente": new Set(["lib/auth/actions.ts#cambiarPassword"]),
  cierre: new Set(["lib/auth/actions.ts#logout", "lib/auth/actions.ts#cerrarSesionPorInactividad"]),
};
const PUBLICAS = new Set(["lib/auth/actions.ts#login"]);

type Funcion = ts.FunctionLikeDeclaration;
type Resultado = { estado: "ok"; exencion?: Exencion } | { estado: "falla"; motivo: string } | { estado: "sin-await" };
export type Accion = { clave: string; resultado: Resultado };

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosFuente(ruta);
    return /\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

// A program over the project, plus optional in-memory files (the fixtures).
function crearPrograma(virtuales: Record<string, string> = {}): ts.Program {
  const config = ts.readConfigFile(join(ROOT, "tsconfig.json"), ts.sys.readFile);
  const opciones = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT).options;
  const host = ts.createCompilerHost({ ...opciones, noEmit: true });
  const leer = host.readFile.bind(host);
  const existe = host.fileExists.bind(host);
  const fuente = host.getSourceFile.bind(host);
  host.readFile = (archivo) => virtuales[archivo] ?? leer(archivo);
  host.fileExists = (archivo) => archivo in virtuales || existe(archivo);
  const carpetas = new Set(Object.keys(virtuales).map((archivo) => archivo.slice(0, archivo.lastIndexOf("/"))));
  const existeCarpeta = host.directoryExists?.bind(host);
  host.directoryExists = (carpeta) => carpetas.has(carpeta) || (existeCarpeta ? existeCarpeta(carpeta) : ts.sys.directoryExists(carpeta));
  host.getSourceFile = (archivo, version, ...resto) =>
    archivo in virtuales
      ? ts.createSourceFile(archivo, virtuales[archivo], version, true, ts.ScriptKind.TSX)
      : fuente(archivo, version, ...resto);
  const raices = Object.keys(virtuales).length > 0 ? Object.keys(virtuales) : archivosFuente(SRC);
  return ts.createProgram({ rootNames: raices, options: { ...opciones, noEmit: true, incremental: false }, host });
}

function directivaUseServer(sentencias: readonly ts.Statement[]): boolean {
  const primera = sentencias[0];
  return (
    primera !== undefined &&
    ts.isExpressionStatement(primera) &&
    ts.isStringLiteral(primera.expression) &&
    primera.expression.text === "use server"
  );
}

function funcionDe(decl: ts.Declaration | undefined): Funcion | null {
  if (!decl) return null;
  if (ts.isFunctionDeclaration(decl) || ts.isFunctionExpression(decl) || ts.isArrowFunction(decl) || ts.isMethodDeclaration(decl)) return decl;
  if (ts.isVariableDeclaration(decl) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
    return decl.initializer;
  }
  if (ts.isExportAssignment(decl) && (ts.isArrowFunction(decl.expression) || ts.isFunctionExpression(decl.expression))) return decl.expression;
  return null;
}

function analizarPrograma(programa: ts.Program, dentroDe: (archivo: string) => boolean): Accion[] {
  const checker = programa.getTypeChecker();

  const simboloReal = (simbolo: ts.Symbol | undefined): ts.Symbol | undefined =>
    simbolo && simbolo.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(simbolo) : simbolo;

  function declaracionDeLlamada(call: ts.CallExpression): ts.Declaration | undefined {
    const objetivo = ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
    const simbolo = simboloReal(checker.getSymbolAtLocation(objetivo));
    return simbolo?.valueDeclaration ?? simbolo?.declarations?.[0];
  }

  const delProyecto = (decl: ts.Declaration) => {
    const archivo = decl.getSourceFile().fileName;
    return archivo.startsWith(SRC) && !archivo.includes("node_modules") && !archivo.endsWith(".d.ts");
  };
  const nombreDecl = (decl: ts.Declaration) => ts.getNameOfDeclaration(decl)?.getText() ?? "";

  function esGuardia(decl: ts.Declaration): boolean {
    return decl.getSourceFile().fileName === GUARDIAS_ARCHIVO && GUARDIAS.has(nombreDecl(decl));
  }
  function esNeutra(decl: ts.Declaration): boolean {
    return NEUTRAS.some(([archivo, nombre]) => decl.getSourceFile().fileName === archivo && nombreDecl(decl) === nombre);
  }

  function exencionDe(call: ts.CallExpression, decl: ts.Declaration): Exencion | "no-literal" | null {
    const nombre = nombreDecl(decl);
    if (nombre === "sesionParaCerrar") return "cierre";
    if (nombre !== "autorizarAccion" || call.arguments.length === 0) return null;
    const arg = call.arguments[0];
    if (!ts.isObjectLiteralExpression(arg)) return "no-literal";
    const permite = arg.properties.some(
      (p) => ts.isPropertyAssignment(p) && p.name.getText() === "permitirCambioPendiente" && p.initializer.kind !== ts.SyntaxKind.FalseKeyword,
    );
    return permite ? "cambio-pendiente" : null;
  }

  function primeraGuardia(fn: Funcion, visitados: Set<Funcion>): Resultado {
    if (visitados.has(fn)) return { estado: "sin-await" };
    visitados.add(fn);
    let resultado: Resultado | null = null;

    const alLlamar = (call: ts.CallExpression, esperada: boolean): void => {
      const decl = declaracionDeLlamada(call);
      if (decl && esNeutra(decl)) return;
      if (decl && esGuardia(decl)) {
        const exencion = exencionDe(call, decl);
        resultado =
          exencion === "no-literal"
            ? { estado: "falla", motivo: "autorizarAccion options must be an object literal" }
            : { estado: "ok", ...(exencion ? { exencion } : {}) };
        return;
      }
      const funcion = decl && delProyecto(decl) ? funcionDe(decl) : null;
      if (funcion) {
        const interno = primeraGuardia(funcion, visitados);
        // A project function without awaits does no I/O: keep looking.
        if (interno.estado !== "sin-await") resultado = interno;
        return;
      }
      if (esperada) resultado = { estado: "falla", motivo: `await ${call.expression.getText().slice(0, 50)}(...)` };
    };

    const visitar = (nodo: ts.Node): void => {
      if (resultado) return;
      if (nodo !== fn && ts.isFunctionLike(nodo)) return;
      if (ts.isAwaitExpression(nodo)) {
        if (ts.isCallExpression(nodo.expression)) {
          // Arguments are evaluated first.
          nodo.expression.arguments.forEach(visitar);
          if (!resultado) alLlamar(nodo.expression, true);
        } else {
          resultado = { estado: "falla", motivo: `await ${nodo.expression.getText().slice(0, 50)}` };
        }
        return;
      }
      if (ts.isCallExpression(nodo)) {
        nodo.arguments.forEach(visitar);
        if (!resultado) alLlamar(nodo, false);
        return;
      }
      ts.forEachChild(nodo, visitar);
    };

    if (fn.body) ts.forEachChild(fn.body, visitar);
    return resultado ?? { estado: "sin-await" };
  }

  const acciones: Accion[] = [];
  for (const archivo of programa.getSourceFiles()) {
    if (!dentroDe(archivo.fileName)) continue;
    const modulo = relative(SRC, archivo.fileName).split("\\").join("/");

    // File-level "use server": every export is an action.
    if (directivaUseServer(archivo.statements)) {
      const simbolo = checker.getSymbolAtLocation(archivo);
      for (const exportado of simbolo ? checker.getExportsOfModule(simbolo) : []) {
        const real = simboloReal(exportado);
        if (!real || !(real.flags & ts.SymbolFlags.Value)) continue;
        const fn = funcionDe(real.valueDeclaration ?? real.declarations?.[0]);
        const clave = `${modulo}#${exportado.getName()}`;
        acciones.push({
          clave,
          resultado: fn ? primeraGuardia(fn, new Set()) : { estado: "falla", motivo: "exported value is not a function" },
        });
      }
    }

    // Inline "use server" functions anywhere in the module.
    const buscar = (nodo: ts.Node): void => {
      if (ts.isFunctionLike(nodo) && "body" in nodo && nodo.body && ts.isBlock(nodo.body) && directivaUseServer(nodo.body.statements)) {
        const nombre = ts.getNameOfDeclaration(nodo as ts.Declaration)?.getText() ??
          (ts.isVariableDeclaration(nodo.parent) ? nodo.parent.name.getText() : `linea ${archivo.getLineAndCharacterOfPosition(nodo.getStart()).line + 1}`);
        acciones.push({ clave: `${modulo}#${nombre} (inline)`, resultado: primeraGuardia(nodo as Funcion, new Set()) });
      }
      ts.forEachChild(nodo, buscar);
    };
    buscar(archivo);
  }
  return acciones;
}

// Problems with an action, or null when it is fine.
function problema({ clave, resultado }: Accion): string | null {
  if (PUBLICAS.has(clave)) return null;
  if (resultado.estado === "sin-await") return `${clave}: no session check`;
  if (resultado.estado === "falla") return `${clave}: ${resultado.motivo} before the session check`;
  if (resultado.exencion && !EXENCIONES_PERMITIDAS[resultado.exencion].has(clave)) {
    return `${clave}: uses the "${resultado.exencion}" exemption, which is not allowed here`;
  }
  return null;
}

describe("Server Action inventory", () => {
  const acciones = analizarPrograma(crearPrograma(), (archivo) => archivo.startsWith(SRC) && !/\.test\.tsx?$/.test(archivo));

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
