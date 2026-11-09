import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The service-role client bypasses RLS. Only two modules may obtain it, and
// every caller checks for an active Admin first: the Admin account module
// and, for the receipts storage (F2-04, Constitution §11), the receipts
// privileged client, which exposes named storage operations only.
const serviceRoleMessage =
  "The service-role client is only allowed in src/lib/admin/cuentas.ts and src/lib/recibos/cliente-privilegiado.ts.";
const serviceRole = {
  paths: [{ name: "@/lib/supabase/admin", message: serviceRoleMessage }],
  patterns: [{ group: ["**/supabase/admin", "**/supabase/admin.ts"], message: serviceRoleMessage }],
};
const serviceRoleAllowed = ["src/lib/admin/cuentas.ts", "src/lib/recibos/cliente-privilegiado.ts"];

// Group E (Datos laborales) is Admin only (AUDCR2-01): its copy and its
// modules (the schema and, AUDCR3-01, its writes) must not reach Mi Legajo's
// client bundle, so Mi Legajo, the app shell, the shared components and the
// shared modules Mi Legajo imports (the shared write helpers of escritura.ts
// included) never import them. scripts/bundle-mi-legajo.mjs checks the built
// chunks.
const grupoEMessage = "Group E is Admin only: Mi Legajo and the shared modules must not import it (AUDCR2-01).";
const grupoE = [
  { group: ["@/lib/copy/laborales", "**/copy/laborales"], message: grupoEMessage },
  { group: ["@/lib/legajo/laborales", "**/legajo/laborales"], message: grupoEMessage },
  { group: ["@/lib/legajo/laborales-escritura", "**/legajo/laborales-escritura"], message: grupoEMessage },
  // Relative imports from inside src/lib/legajo or src/lib/copy.
  { group: ["./laborales", "./laborales-escritura"], message: grupoEMessage },
];

// F2-03: the receipts orphan sweep is Admin only (Constitution §11). Mi
// Legajo, the app shell, the shared components and the shared modules never
// import it; the future Mis Recibos route reaches receipts only through its
// own Server Actions.
const recibosAdminMessage = "Receipts Admin modules (sweep, Carga de recibos, privileged client) must not be imported by employee routes or shared modules (F2-03, F2-04).";
// F2-04 adds the Carga de recibos modules: its copy, its server logic and
// flow, and the privileged storage client.
const recibosAdmin = [
  { group: ["@/lib/recibos/limpieza", "**/recibos/limpieza"], message: recibosAdminMessage },
  {
    group: [
      "@/lib/copy/recibos",
      "**/copy/recibos",
      "@/lib/recibos/carga",
      "@/lib/recibos/carga-*",
      "**/recibos/carga",
      "**/recibos/carga-*",
    ],
    message: recibosAdminMessage,
  },
];

// F2-04, F2-05: the receipts privileged storage client is shared by the
// Admin's Carga de recibos and the employee's Mis Recibos server logic, and
// only those two modules may import it; each authorizes its caller first.
const privilegiadoMessage =
  "The receipts privileged client may only be imported by src/lib/recibos/carga.ts and src/lib/recibos/firma.ts (F2-04, F2-05).";
const privilegiado = [
  {
    group: ["@/lib/recibos/cliente-privilegiado", "**/recibos/cliente-privilegiado", "./cliente-privilegiado"],
    message: privilegiadoMessage,
  },
];
const privilegiadoAllowed = ["src/lib/recibos/carga.ts", "src/lib/recibos/firma.ts"];

// F2-07: the PDF libraries run on the server only, behind the two receipt
// wrappers (src/lib/recibos/pdf-texto.ts and pdf-firma.ts, "server-only").
// No other file imports them; the wrappers' own tests do, to build fixtures.
// An explicit list, not a glob (AUD-07-01): a new pdf-*.ts file is not exempt.
const pdfLibsMessage = "PDF libraries are only allowed in src/lib/recibos/pdf-texto.ts and pdf-firma.ts (F2-07, AUD-07-01).";
const pdfLibs = [
  { group: ["unpdf", "unpdf/*", "@cantoo/pdf-lib", "@cantoo/pdf-lib/*"], message: pdfLibsMessage },
];
const pdfWrappers = [
  "src/lib/recibos/pdf-texto.ts",
  "src/lib/recibos/pdf-firma.ts",
  "src/lib/recibos/pdf-texto.test.ts",
  "src/lib/recibos/pdf-texto-tiempo.test.ts",
  "src/lib/recibos/pdf-firma.test.ts",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: [...serviceRoleAllowed, ...pdfWrappers, ...privilegiadoAllowed],
    rules: {
      "no-restricted-imports": ["error", { ...serviceRole, patterns: [...serviceRole.patterns, ...pdfLibs, ...privilegiado] }],
    },
  },
  // The two receipts modules allowed the privileged client keep the rest.
  {
    files: privilegiadoAllowed,
    rules: {
      "no-restricted-imports": ["error", { ...serviceRole, patterns: [...serviceRole.patterns, ...pdfLibs] }],
    },
  },
  // The files allowed the service-role client still may not use the PDF
  // libraries.
  {
    files: serviceRoleAllowed,
    rules: {
      "no-restricted-imports": ["error", { patterns: [...pdfLibs, ...privilegiado] }],
    },
  },
  // The PDF wrappers keep the service-role restriction.
  {
    files: pdfWrappers,
    rules: {
      "no-restricted-imports": ["error", { ...serviceRole, patterns: [...serviceRole.patterns, ...privilegiado] }],
    },
  },
  // Replaces the rule's options for these files, so it repeats serviceRole,
  // pdfLibs and privilegiado.
  {
    files: [
      "src/app/*.{ts,tsx}",
      "src/app/(app)/*.{ts,tsx}",
      "src/app/(app)/mi-legajo/**/*.{ts,tsx}",
      // F2-05: the employee's receipts route and its modules.
      "src/app/(app)/mis-recibos/**/*.{ts,tsx}",
      "src/lib/copy/mis-recibos.ts",
      "src/lib/recibos/mis-recibos-datos.ts",
      "src/lib/recibos/dibujo.ts",
      "src/components/**/*.{ts,tsx}",
      "src/lib/copy/es-AR.ts",
      "src/lib/documentos/**/*.{ts,tsx}",
      "src/lib/legajo/{antiguedad,cuil,escritura,fechas,grupos,mi-legajo,options,validation,vista}.ts",
    ],
    ignores: [
      "**/*.test.{ts,tsx}",
      // CR-4, the one exception: the Admin's own group E, read only, in Mi
      // Legajo. A "server-only" server component rendered only for an Admin,
      // so nothing of it reaches the route's client chunks (the bundle check
      // still runs). The general rule above still applies to it.
      "src/app/(app)/mi-legajo/DatosLaboralesPropios.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        { ...serviceRole, patterns: [...serviceRole.patterns, ...grupoE, ...recibosAdmin, ...pdfLibs, ...privilegiado] },
      ],
    },
  },
  // F2-05: the employee's signing logic may use the privileged client, but
  // nothing Admin only.
  {
    files: ["src/lib/recibos/firma.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { ...serviceRole, patterns: [...serviceRole.patterns, ...grupoE, ...recibosAdmin, ...pdfLibs] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Test artifacts:
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
