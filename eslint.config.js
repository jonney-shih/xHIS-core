import tseslint from 'typescript-eslint';
import { noCommitWithoutFreshRead } from './eslint-rules/no-commit-without-fresh-read.js';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['packages/*/tsconfig.json'],
        tsconfigRootDir: process.cwd(),
      },
    },
    plugins: {
      xhis: {
        rules: {
          'no-commit-without-fresh-read': noCommitWithoutFreshRead,
        },
      },
    },
    rules: {
      'xhis/no-commit-without-fresh-read': 'error',
    },
  },
);
