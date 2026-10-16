import { describe, expect, it } from 'vitest';
import { PostgresShellConflictError } from '../src/conflictError.js';

describe('PostgresShellConflictError', () => {
  it('carries the tenant and the version that lost the race, and a message naming both', () => {
    const error = new PostgresShellConflictError('hospital-a', 7n);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PostgresShellConflictError');
    expect(error.tenantId).toBe('hospital-a');
    expect(error.attemptedVersion).toBe(7n);
    expect(error.message).toContain('hospital-a');
    expect(error.message).toContain('7');
  });
});
