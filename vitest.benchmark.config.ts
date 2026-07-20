import { defineConfig } from 'vitest/config';

/**
 * A separate config, not just a differently-scoped run of the main one
 * — `vitest.config.ts` actively excludes `tests/benchmarks/**`, and
 * exclude wins over an explicit path argument in vitest, so pointing
 * the default config at this directory would still run nothing. Run
 * via `npm run benchmark`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/benchmarks/**/*.bench.test.ts'],
  },
});
