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
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../commands/*', '../ui/*'],
              message: 'Core modules must not depend on presentation layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/commands/**/*.ts', 'src/ui/**/*.ts', 'src/cli.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['tests/**/*.mjs', 'scripts/**/*.mjs', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
  { files: ['ui/**/*.js'], languageOptions: { globals: globals.browser } },
  prettier,
]);
