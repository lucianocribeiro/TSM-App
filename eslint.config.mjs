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
// module must not reach Mi Legajo's client bundle, so Mi Legajo, the app
// shell, the shared components and the shared modules Mi Legajo imports
// never import them. scripts/bundle-mi-legajo.mjs checks the built chunks.
const grupoEMessage = "Group E is Admin only: Mi Legajo and the shared modules must not import it (AUDCR2-01).";
const grupoE = [
  { group: ["@/lib/copy/laborales", "**/copy/laborales"], message: grupoEMessage },
  { group: ["@/lib/legajo/laborales", "**/legajo/laborales"], message: grupoEMessage },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["src/lib/admin/cuentas.ts"],
    rules: {
      "no-restricted-imports": ["error", serviceRole],
    },
  },
  // Replaces the rule's options for these files, so it repeats serviceRole.
  {
    files: [
      "src/app/*.{ts,tsx}",
      "src/app/(app)/*.{ts,tsx}",
      "src/app/(app)/mi-legajo/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/lib/copy/es-AR.ts",
      "src/lib/documentos/**/*.{ts,tsx}",
      "src/lib/legajo/{antiguedad,cuil,fechas,grupos,mi-legajo,options,validation,vista}.ts",
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
      "no-restricted-imports": ["error", { ...serviceRole, patterns: [...serviceRole.patterns, ...grupoE] }],
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
