import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Action inventory (PRD session rules): every exported Server Action checks
// the session (and role) before any I/O. Each "use server" module under src
// is parsed with the TypeScript compiler; for each exported function, the
// first awaited call, in source order, must be a session/role helper, or a
// function of the same module whose own first awaited call is one (followed
// recursively, also for a returned call such as `return run(...)`).
// createClient only builds the session-bound client from the cookies, so it
// is skipped. Anything else first (a query, an rpc, storage) fails the test.

const SRC = join(process.cwd(), "src");

// Helpers that read and verify the caller's session (and role).
const GUARDIAS = new Set(["sessionWithRole", "getSessionUser", "requireRole", "getUser"]);
// Calls that are not I/O and may come before the check.
const NEUTRAS = new Set(["createClient"]);
// Actions that by design act before or without a session, and touch no data
// of anyone's but the caller's own session.
const EXENTAS: Record<string, string> = {
  "lib/auth/actions.ts#login": "signs in: there is no session yet",
  "lib/auth/actions.ts#logout": "ends the caller's own session only",
  "lib/auth/actions.ts#cerrarSesionPorInactividad": "ends the caller's own session only",
};

function modulosServidor(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return modulosServidor(ruta);
    if (!/\.tsx?$/.test(nombre) || /\.test\.tsx?$/.test(nombre)) return [];
    const texto = readFileSync(ruta, "utf8");
    return /^\s*["']use server["']/.test(texto) ? [ruta] : [];
  });
}

type Funcion = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function nombreLlamada(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

// Each exported function of a module, with "ok" or what came first instead
// of a session check.
function analizar(fuente: ts.SourceFile): { nombre: string; resultado: string }[] {
  const locales = new Map<string, Funcion>();
  const exportadas: { nombre: string; fn: Funcion | null }[] = [];

  for (const sentencia of fuente.statements) {
    const exportada = ts.canHaveModifiers(sentencia) && ts.getModifiers(sentencia)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(sentencia) && sentencia.name) {
      locales.set(sentencia.name.text, sentencia);
      if (exportada) exportadas.push({ nombre: sentencia.name.text, fn: sentencia });
    } else if (ts.isVariableStatement(sentencia)) {
      for (const decl of sentencia.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const init = decl.initializer;
        const fn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : null;
        if (fn) locales.set(decl.name.text, fn);
        if (exportada) exportadas.push({ nombre: decl.name.text, fn });
      }
    } else if (exportada && !ts.isTypeAliasDeclaration(sentencia) && !ts.isInterfaceDeclaration(sentencia)) {
      exportadas.push({ nombre: sentencia.getText(fuente).slice(0, 40), fn: null });
    }
  }

  function primeraGuardia(fn: Funcion, visitados: Set<Funcion>): string {
    if (visitados.has(fn)) return "recursion";
    visitados.add(fn);
    let resultado: string | null = null;

    const visitar = (nodo: ts.Node): void => {
      if (resultado) return;
      // Closures run later: they are not the start of this function.
      if (nodo !== fn && (ts.isArrowFunction(nodo) || ts.isFunctionExpression(nodo) || ts.isFunctionDeclaration(nodo))) return;

      if (ts.isAwaitExpression(nodo)) {
        const call = ts.isCallExpression(nodo.expression) ? nodo.expression : null;
        const nombre = call ? nombreLlamada(call) : null;
        if (nombre && NEUTRAS.has(nombre)) return;
        if (nombre && GUARDIAS.has(nombre)) {
          resultado = "ok";
          return;
        }
        const local = nombre ? locales.get(nombre) : undefined;
        resultado = local ? primeraGuardia(local, visitados) : `await ${nombre ?? nodo.expression.getText(fuente).slice(0, 40)}(...)`;
        return;
      }
      // A call to a local helper that is returned or awaited later.
      if (ts.isCallExpression(nodo) && ts.isIdentifier(nodo.expression)) {
        const local = locales.get(nodo.expression.text);
        if (local) {
          resultado = primeraGuardia(local, visitados);
          return;
        }
      }
      ts.forEachChild(nodo, visitar);
    };

    if (fn.body) ts.forEachChild(fn.body, visitar);
    return resultado ?? "no awaited call";
  }

  return exportadas.map(({ nombre, fn }) => ({ nombre, resultado: fn ? primeraGuardia(fn, new Set()) : "not a function" }));
}

function analizarModulo(ruta: string) {
  const fuente = ts.createSourceFile(ruta, readFileSync(ruta, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const modulo = relative(SRC, ruta).split("\\").join("/");
  return analizar(fuente).map(({ nombre, resultado }) => ({ clave: `${modulo}#${nombre}`, resultado }));
}

describe("Server Action inventory", () => {
  const modulos = modulosServidor(SRC);
  const acciones = modulos.flatMap(analizarModulo);

  it("finds every \"use server\" module and its actions", () => {
    expect(modulos.length).toBeGreaterThanOrEqual(5);
    expect(acciones.length).toBeGreaterThanOrEqual(30);
  });

  it("every exported action checks the session or role before any I/O", () => {
    const fallas = acciones
      .filter(({ clave }) => !(clave in EXENTAS))
      .filter(({ resultado }) => resultado !== "ok")
      .map(({ clave, resultado }) => `${clave}: ${resultado}`);
    expect(fallas).toEqual([]);
  });

  it("the exemptions still exist (none is left stale)", () => {
    const claves = new Set(acciones.map(({ clave }) => clave));
    for (const clave of Object.keys(EXENTAS)) expect(claves.has(clave), clave).toBe(true);
  });

  it("detects an action that queries before checking (self-test)", () => {
    const fuente = ts.createSourceFile(
      "fixture.ts",
      `"use server";
      async function guard() { return await sessionWithRole("admin"); }
      export async function mala() { const s = await createClient(); await s.from("x").select(); await sessionWithRole("admin"); }
      export async function sinNada() { return 1; }
      export async function buena() { if (!(await guard())) return; }
      export async function delegada(i: unknown) { return run(i); }
      async function run(i: unknown) { await getSessionUser(); return i; }`,
      ts.ScriptTarget.Latest,
      true,
    );
    expect(Object.fromEntries(analizar(fuente).map(({ nombre, resultado }) => [nombre, resultado]))).toEqual({
      mala: "await select(...)",
      sinNada: "no awaited call",
      buena: "ok",
      delegada: "ok",
    });
  });
});
