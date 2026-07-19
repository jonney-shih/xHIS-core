import { describe, expect, it } from 'vitest';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';

describe('createInMemoryIdentityProvider', () => {
  const provider = createInMemoryIdentityProvider([
    { id: 'dr-chen', displayName: 'Dr. Chen', roles: ['clinical-approver'] },
  ]);

  it('resolves a known identity by ID', () => {
    expect(provider.resolve('dr-chen')).toEqual({
      id: 'dr-chen',
      displayName: 'Dr. Chen',
      roles: ['clinical-approver'],
    });
  });

  it('returns undefined for an unknown identity', () => {
    expect(provider.resolve('nobody')).toBeUndefined();
  });
});
