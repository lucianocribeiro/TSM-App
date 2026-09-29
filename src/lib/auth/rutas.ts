// Route map (PRD session rules): every page and route handler under src/app,
// classified. Anything not in the map is denied by default. A unit test
// (rutas.test.ts) fails when a page or route handler exists without an entry,
// or an entry without a page. Static assets (/_next, favicon, images) never
// reach the proxy (see the matcher in src/proxy.ts).

export type ClaseRuta = "publica" | "autenticada" | "admin";

export type EntradaRuta = {
  // The route as the app defines it; [param] matches one path segment.
  patron: string;
  clase: ClaseRuta;
};

export const RUTAS = [
  // Public: sign-in and the sign-out handler (it decides on its own).
  { patron: "/login", clase: "publica" },
  { patron: "/auth/salir", clase: "publica" },
  // Any signed-in user.
  { patron: "/", clase: "autenticada" },
  { patron: "/mi-legajo", clase: "autenticada" },
  { patron: "/cambiar-password", clase: "autenticada" },
  // Admin only.
  { patron: "/legajos", clase: "admin" },
  { patron: "/legajos/[id]", clase: "admin" },
  { patron: "/usuarios", clase: "admin" },
  { patron: "/usuarios/[id]", clase: "admin" },
  { patron: "/aprobaciones", clase: "admin" },
  { patron: "/aprobaciones/solicitudes/[id]", clase: "admin" },
  { patron: "/aprobaciones/documentos/[id]", clase: "admin" },
] as const satisfies readonly EntradaRuta[];

// Admin sections: anything below them is Admin only as well, even a path
// with no page (it then gets the not-found page, but only for an Admin).
const SECCIONES_ADMIN = ["/legajos", "/usuarios", "/aprobaciones"];

function coincide(patron: string, pathname: string): boolean {
  const a = patron.split("/");
  const b = pathname.split("/");
  if (a.length !== b.length) return false;
  return a.every((segmento, i) => (/^\[[^\]]+\]$/.test(segmento) ? b[i] !== "" : segmento === b[i]));
}

// The class of a path, or null when it is not in the map (denied).
export function clasificarRuta(pathname: string): ClaseRuta | null {
  const entrada = RUTAS.find((ruta) => coincide(ruta.patron, pathname));
  if (entrada) return entrada.clase;
  if (SECCIONES_ADMIN.some((seccion) => pathname.startsWith(`${seccion}/`))) return "admin";
  return null;
}
