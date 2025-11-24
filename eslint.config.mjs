import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const nextCoreWebVitals = nextPlugin.configs['core-web-vitals'] ?? {};
const nextSettings = nextCoreWebVitals.settings;

export default tseslint.config(
  {
    ignores: ['node_modules', '.next', 'dist', 'coverage', '*.config.mjs', 'tmp-component-usage.json'],
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
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.mjs'],
      },
    },
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...(nextCoreWebVitals.rules ?? {}),
      'react-hooks/exhaustive-deps': 'off',
      '@next/next/no-duplicate-head': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': 'warn',
      'no-constant-binary-expression': 'off',
      'no-case-declarations': 'off',
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-dupe-else-if': 'off',
    },
    ...(nextSettings ? { settings: nextSettings } : {}),
  },
  eslintConfigPrettier,
);