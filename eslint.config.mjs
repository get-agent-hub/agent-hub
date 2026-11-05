import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/**', 'node_modules/**', '.tmp/**', '.firecrawl/**', 'coverage/**']),
  {
    files: ['**/*.{js,mjs,ts}'],
    extends: [js.configs.recommended],
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
      'prefer-const': 'error',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    extends: [ts.configs.recommended],
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      'max-lines': ['error', { max: 400 }],
      'max-lines-per-function': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
    },
  },
  { files: ['src/core/**/*.ts'], rules: { 'no-console': 'error' } },
  { files: ['tests/**/*.mjs'], rules: { 'max-lines': ['error', { max: 800 }] } },
  { files: ['scripts/**/*.mjs'], rules: { 'max-lines': ['error', { max: 400 }] } },
  {
    files: ['tests/**/*.mjs', 'scripts/**/*.mjs', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
  { files: ['ui/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['ui/app/**/*.js'], rules: { 'max-lines': ['error', { max: 400 }] } },
  // Existing browser shell is held at its current size until the separate UI rebuild.
  { files: ['ui/app/app.js'], rules: { 'max-lines': ['error', { max: 765 }] } },
  prettier,
]);
