import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const restrict = (patterns, paths = []) => ({
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      paths: paths.map((name) => ({ name, allowTypeImports: false })),
      patterns: patterns.map((group) => ({ group: [group], allowTypeImports: false })),
    },
  ],
});

export default tseslint.config(
  { ignores: ['dist/', 'playwright-report/', 'test-results/', 'coverage/', 'dev-dist/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    // engine/ is pure: no DOM framework, Dexie, platform, UI or content. Types from data/types stay allowed.
    files: ['src/engine/**/*.ts'],
    ignores: ['src/engine/**/*.test.ts'],
    rules: restrict(
      ['preact/*', '@preact/*', 'virtual:*', '**/data/db*', '**/data/backup*', '**/data/settings*', '**/platform/**', '**/ui/**', '**/content/**'],
      ['dexie', 'preact'],
    ),
  },
  {
    // content/ is static data: it reads nothing else.
    files: ['src/content/**/*.ts'],
    ignores: ['src/content/**/*.test.ts'],
    rules: restrict(['preact/*', '**/data/db*', '**/platform/**', '**/ui/**', '**/engine/**'], ['dexie', 'preact']),
  },
  {
    files: ['src/data/**/*.ts'],
    ignores: ['src/data/live.ts', 'src/data/**/*.test.ts'],
    rules: restrict(['preact/*', '**/ui/**'], ['preact']),
  },
);
