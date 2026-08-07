import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Benchmarks are diagnostic measurements, not correctness assertions
    // — excluded from the routine suite so `npm test` stays fast and
    // deterministic. Run them explicitly with `npm run benchmark`, which
    // points at vitest.benchmark.config.ts instead.
    exclude: ['tests/benchmarks/**'],
  },
});
