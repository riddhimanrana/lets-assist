import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const nextCoreWebVitals = nextPlugin.configs["core-web-vitals"] ?? {};
const nextSettings = nextCoreWebVitals.settings;

export default tseslint.config(
  {
    ignores: [
      "node_modules",
      ".next",
      ".next-csf-isolated",
      "dist",
      "coverage",
      ".artifacts/**",
      // Local agent memory caches are generated outside the source tree.
      ".remember/**",
      // Design-sync tooling drops generated bundles at the repo root; they are
      // not source and must not fail the zero-warning gate.
      ".design-sync/**",
      ".ds-sync/**",
      "ds-bundle/**",
      "supabase/.temp/**",
      "*.config.mjs",
      "tmp-component-usage.json",
      "**/*.backup.tsx",
      // Application-profile plugins own a locked package toolchain and run the
      // required gates through plugin:apps:check.
      "lib/plugins/private/apps/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        extraFileExtensions: [".mjs"],
      },
    },
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...(nextCoreWebVitals.rules ?? {}),
      "react-hooks/exhaustive-deps": "off",
      "@next/next/no-duplicate-head": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-empty": "warn",
      "no-constant-binary-expression": "off",
      "no-case-declarations": "off",
      "prefer-const": "warn",
      "no-useless-escape": "warn",
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "no-dupe-else-if": "off",
    },
    ...(nextSettings ? { settings: nextSettings } : {}),
  },
  eslintConfigPrettier,
);
