import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The service-role client bypasses RLS. Only the Admin account module may
  // use it, and every function there checks the caller is an Admin first.
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["src/lib/admin/cuentas.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
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
        },
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
