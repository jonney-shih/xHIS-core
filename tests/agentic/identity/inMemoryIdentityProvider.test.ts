import { describe, expect, it } from 'vitest';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';

describe('createInMemoryIdentityProvider', () => {
  const provider = createInMemoryIdentityProvider([
    { id: 'dr-chen', displayName: 'Dr. Chen', roles: ['clinical-approver'] },
  ]);

  it('resolves a known identity by ID, ignoring asOf entirely', () => {
    expect(provider.resolve('dr-chen', '2026-07-21T00:00:00.000Z')).toEqual({
      id: 'dr-chen',
      displayName: 'Dr. Chen',
      roles: ['clinical-approver'],
    });
  });

  it('returns undefined for an unknown identity', () => {
    expect(provider.resolve('nobody', '2026-07-21T00:00:00.000Z')).toBeUndefined();
  });
});
