import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../src/pgErrors.js';

describe('isUniqueViolation', () => {
  it('recognizes a Postgres unique-violation error by its SQLSTATE code', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('rejects an unrelated error code', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
  });

  it('rejects non-error-shaped values without throwing', () => {
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('boom')).toBe(false);
    expect(isUniqueViolation(new Error('plain error, no code'))).toBe(false);
  });
});
