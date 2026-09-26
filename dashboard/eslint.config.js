import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Layer boundaries (MIGRATION-REACT.md §2.2): web never imports bff; core
// imports nothing outside core (no I/O, no framework). A test lints a
// deliberately bad import so these rules are proven to fire.
const webBoundary = {
  patterns: [{ group: ['**/bff/**', 'fastify', '@fastify/*', 'node:*', 'pino', 'jose'], message: 'web must not import the BFF or server-side modules.' }],
};
const coreBoundary = {
  patterns: [
    {
      group: ['**/bff/**', '**/web/**', 'node:*', 'fastify', '@fastify/*', 'react', 'react-dom', 'react-dom/*', 'zod', 'pino', 'jose'],
      message: 'core is pure: it imports nothing outside core.',
    },
  ],
};

// Raw HTML is banned everywhere (catalog 2.02 / 2.04): text goes through JSX only.
const noRawHtml = {
  'no-restricted-properties': [
    'error',
    { property: 'innerHTML', message: 'Raw HTML is banned (2.02).' },
    { property: 'outerHTML', message: 'Raw HTML is banned (2.02).' },
    { property: 'insertAdjacentHTML', message: 'Raw HTML is banned (2.02).' },
  ],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
};

export default tseslint.config(
  { ignores: ['node_modules/**', 'web/dist/**', 'coverage/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...noRawHtml,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['bff/**/*.ts', 'test/core/**', 'test/bff/**', 'test/contract/**', 'test/lint/**', 'test/support/**', 'test/integration/**', 'vitest.config.ts', 'web/vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['core/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', coreBoundary] },
  },
  {
    files: ['web/src/**/*.{ts,tsx}', 'test/web/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: { globals: globals.browser },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.strict.rules,
      'react/no-danger': 'error',
      'react/no-danger-with-children': 'error',
      'react/prop-types': 'off',
    },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', webBoundary] },
  },
);
