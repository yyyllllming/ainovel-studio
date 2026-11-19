import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const restrictedServerImports = [
  {
    name: "@/server/run-manager",
    message: "Use dedicated run services or the compat boundary instead of importing run-manager directly.",
  },
  {
    name: "@/server/repository",
    message: "Import focused repositories directly instead of the repository barrel.",
  },
  {
    name: "@/server/project-files",
    message: "Route and service layers should use focused services instead of project-files directly.",
  },
  {
    name: "@/server/profiles",
    message: "Route and page layers should use settings services instead of profiles storage directly.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/api/**/*.{ts,tsx}", "src/app/projects/**/*.tsx", "src/app/settings/page.tsx"],
    rules: {
      "no-restricted-imports": ["error", { paths: restrictedServerImports }],
    },
  },
  {
    files: ["src/server/run/**/*.{ts,tsx}", "src/server/services/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: restrictedServerImports }],
    },
  },
  {
    files: [
      // Temporary baseline exceptions unrelated to the import-boundary rollout.
      "src/server/run-control-service.test.ts",
      "src/server/run/launcher.service.ts",
      "src/server/story-progression.test.ts",
    ],
    rules: {
      "prefer-const": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist-worker/**",
    "next-env.d.ts",
    // Runtime content and local data stores:
    "authors/**",
    "config/**",
    "data/**",
    "ideas/**",
    "projects/**",
    "tmp/**",
  ]),
]);

export default eslintConfig;
