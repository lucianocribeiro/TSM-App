import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The service-role client bypasses RLS. Only the Admin account module may
// use it, and every function there checks the caller is an Admin first.
const serviceRole = {
  paths: [
    {
      name: "@/lib/supabase/admin",
      message: "The service-role client is only allowed in src/lib/admin/cuentas.ts.",
    },
  ],
  patterns: [
    {
      group: ["**/supabase/admin", "**/supabase/admin.ts"],
      message: "The service-role client is only allowed in src/lib/admin/cuentas.ts.",
    },
  ],
};

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
const recibosAdminMessage = "The receipts sweep is Admin only: employee routes and shared modules must not import it (F2-03).";
const recibosAdmin = [
  { group: ["@/lib/recibos/limpieza", "**/recibos/limpieza"], message: recibosAdminMessage },
];

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
    ignores: ["src/lib/admin/cuentas.ts", ...pdfWrappers],
    rules: {
      "no-restricted-imports": ["error", { ...serviceRole, patterns: [...serviceRole.patterns, ...pdfLibs] }],
    },
  },
  // The one file allowed the service-role client still may not use the PDF
  // libraries.
  {
    files: ["src/lib/admin/cuentas.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: pdfLibs }],
    },
  },
  // The PDF wrappers keep the service-role restriction.
  {
    files: pdfWrappers,
    rules: {
      "no-restricted-imports": ["error", serviceRole],
    },
  },
  // Replaces the rule's options for these files, so it repeats serviceRole
  // and pdfLibs.
  {
    files: [
      "src/app/*.{ts,tsx}",
      "src/app/(app)/*.{ts,tsx}",
      "src/app/(app)/mi-legajo/**/*.{ts,tsx}",
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
