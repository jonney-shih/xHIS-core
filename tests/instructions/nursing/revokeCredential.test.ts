import { describe, expect, it } from 'vitest';
import { revokeCredentialHandler } from '../../../src/instructions/nursing/handlers/revokeCredential.js';
import { credentialId, isoTimestamp, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingContext } from '../../../src/instructions/nursing/types.js';

const contextWithActiveCredential: NursingContext = {
  credentials: {
    'cred-1': {
      credentialId: credentialId('cred-1'),
      staffId: staffId('nurse-1'),
      credentialType: 'ACLS',
      status: 'active',
      issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
      expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z'),
    },
  },
  roleGrants: {},
};

describe('revokeCredentialHandler', () => {
  it('revokes an active credential and emits a CredentialRevoked effect', () => {
    const result = revokeCredentialHandler(contextWithActiveCredential, {
      kind: 'RevokeCredential',
      credentialId: credentialId('cred-1'),
      revokedAt: isoTimestamp('2026-06-01T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.credentials['cred-1']).toEqual({
      ...contextWithActiveCredential.credentials['cred-1'],
      status: 'revoked',
      revokedAt: '2026-06-01T00:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'CredentialRevoked', credentialId: 'cred-1', staffId: 'nurse-1', revokedAt: '2026-06-01T00:00:00.000Z' },
    ]);
  });

  it('rejects revoking a credential that does not exist', () => {
    const result = revokeCredentialHandler(
      { credentials: {}, roleGrants: {} },
      { kind: 'RevokeCredential', credentialId: credentialId('cred-1'), revokedAt: isoTimestamp('2026-06-01T00:00:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'CredentialNotFound', credentialId: 'cred-1' } });
  });

  it('rejects revoking a credential that is already revoked', () => {
    const alreadyRevoked: NursingContext = {
      credentials: {
        'cred-1': { ...contextWithActiveCredential.credentials['cred-1']!, status: 'revoked', revokedAt: isoTimestamp('2026-03-01T00:00:00.000Z') },
      },
      roleGrants: {},
    };

    const result = revokeCredentialHandler(alreadyRevoked, {
      kind: 'RevokeCredential',
      credentialId: credentialId('cred-1'),
      revokedAt: isoTimestamp('2026-06-01T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'CredentialAlreadyRevoked', credentialId: 'cred-1' } });
  });
});
