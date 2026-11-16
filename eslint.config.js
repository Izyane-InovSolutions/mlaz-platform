// ESLint for the whole repository: the browser UI (src/), Node scripts and tests, and the TypeScript API (server/).
// Run with `npm run lint`. Type checking is separate (`npm run typecheck`, using server/'s own TypeScript).
// Turning a rule off here needs a reason in a comment; prefer a line-level disable with a reason for single cases.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/node_modules/', 'dist/', 'server/dist/', 'server/src/generated/', 'coverage/', 'server/coverage/',
    'server/storage/', 'server/storage-test/', 'server/upload-tmp-test/',
  ]),

  js.configs.recommended,
  security.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // Code built from strings.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      // Mistakes that look intentional.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Flags every obj[key]; with no data flow analysis it is almost all noise. Prototype pollution is covered by
      // tests (multipart __proto__) and by validation with zod on the API.
      'security/detect-object-injection': 'off',
      // Flags every fs call with a computed path. Off in general; enforced below where request data arrives.
      'security/detect-non-literal-fs-filename': 'off',
    },
  },

  // Request handlers and services must reach files only through lib/storage.ts and lib/uploads.ts, which confine
  // paths to their directories (tested in server/test/phase3.test.ts, "ignores path tricks in file names").
  {
    files: ['server/src/routes/**/*.ts', 'server/src/services/**/*.ts'],
    rules: { 'security/detect-non-literal-fs-filename': 'error' },
  },

  // Browser UI. It holds no secrets, so comparison timing is irrelevant here.
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.browser },
    rules: { 'security/detect-possible-timing-attacks': 'off' },
  },

  // Node: build config, scripts, hooks and tests. Their paths and patterns come from the repository, not from users.
  {
    files: ['*.js', 'scripts/**/*.mjs', 'test/**/*.mjs', '.husky/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['test/**', 'server/test/**', 'scripts/**'],
    rules: { 'security/detect-non-literal-regexp': 'off' },
  },

  // API.
  {
    files: ['server/**/*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
]);
