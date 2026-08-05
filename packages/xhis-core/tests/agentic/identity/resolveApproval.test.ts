import { describe, expect, it } from 'vitest';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApproval } from '../../../src/agentic/identity/resolveApproval.js';

const identityProvider = createInMemoryIdentityProvider([
  { id: 'dr-chen', displayName: 'Dr. Chen', roles: ['clinical-approver'] },
  { id: 'nurse-lin', displayName: 'Nurse Lin', roles: ['reviewer'] },
  { id: 'nurse-wu', displayName: 'Nurse Wu', roles: ['reviewer', 'charge-nurse'] },
]);

describe('resolveApproval', () => {
  it('resolves an approval from a known identity holding the required role', () => {
    const result = resolveApproval(identityProvider, ['clinical-approver'], {
      approverId: 'dr-chen',
      approved: true,
      decidedAt: '2026-07-19T00:05:00.000Z',
    });

    expect(result).toEqual({
      kind: 'resolved',
      approval: {
        approverId: 'dr-chen',
        approverRole: 'clinical-approver',
        approved: true,
        decidedAt: '2026-07-19T00:05:00.000Z',
      },
    });
  });

  it('resolves a decline from a known identity holding the required role', () => {
    const result = resolveApproval(identityProvider, ['clinical-approver'], {
      approverId: 'dr-chen',
      approved: false,
      decidedAt: '2026-07-19T00:05:00.000Z',
    });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') throw new Error('expected resolved');
    expect(result.approval.approved).toBe(false);
  });

  it('does not resolve an approval claimed by an unknown identity', () => {
    const result = resolveApproval(identityProvider, ['clinical-approver'], {
      approverId: 'impersonator',
      approved: true,
      decidedAt: '2026-07-19T00:05:00.000Z',
    });

    expect(result).toEqual({ kind: 'unresolved', reason: "no identity found for approver 'impersonator'" });
  });

  it('does not resolve an approval from a real identity holding none of the required roles', () => {
    const result = resolveApproval(identityProvider, ['clinical-approver'], {
      approverId: 'nurse-lin',
      approved: true,
      decidedAt: '2026-07-19T00:05:00.000Z',
    });

    expect(result).toEqual({
      kind: 'unresolved',
      reason: "identity 'nurse-lin' holds none of the required roles [clinical-approver]",
    });
  });

  it('does not resolve a decline from an unknown identity either', () => {
    const result = resolveApproval(identityProvider, ['clinical-approver'], {
      approverId: 'impersonator',
      approved: false,
      decidedAt: '2026-07-19T00:05:00.000Z',
    });

    expect(result.kind).toBe('unresolved');
  });

  it('resolves when the identity holds any one of several acceptable roles', () => {
    const result = resolveApproval(identityProvider, ['physician', 'charge-nurse'], {
      approverId: 'nurse-wu',
      approved: true,
      decidedAt: '2026-07-19T00:05:00.000Z',
    });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') throw new Error('expected resolved');
    // Records the specific role that matched, not the whole acceptable list.
    expect(result.approval.approverRole).toBe('charge-nurse');
  });

  it('fails closed when no roles are required at all', () => {
    const result = resolveApproval(identityProvider, [], {
      approverId: 'dr-chen',
      approved: true,
      decidedAt: '2026-07-19T00:05:00.000Z',
    });

    expect(result).toEqual({
      kind: 'unresolved',
      reason: "identity 'dr-chen' holds none of the required roles []",
    });
  });
});
