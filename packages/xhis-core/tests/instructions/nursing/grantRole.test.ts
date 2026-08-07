import { describe, expect, it } from 'vitest';
import { grantRoleHandler } from '../../../src/instructions/nursing/handlers/grantRole.js';
import { credentialId, isoTimestamp, roleGrantId, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingContext } from '../../../src/instructions/nursing/types.js';

const contextWithValidCredential: NursingContext = {
  credentials: {
    'cred-1': {
      credentialId: credentialId('cred-1'),
      staffId: staffId('nurse-1'),
      credentialType: 'Charge-Nurse-Cert',
      status: 'active',
      issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
      expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z'),
    },
  },
  roleGrants: {},
};

describe('grantRoleHandler', () => {
  it('grants a role backed by a valid credential and emits a RoleGranted effect', () => {
    const result = grantRoleHandler(contextWithValidCredential, {
      kind: 'GrantRole',
      grantId: roleGrantId('grant-1'),
      staffId: staffId('nurse-1'),
      role: 'charge-nurse',
      credentialId: credentialId('cred-1'),
      grantedAt: isoTimestamp('2026-06-01T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.roleGrants['grant-1']).toEqual({
      grantId: 'grant-1',
      staffId: 'nurse-1',
      role: 'charge-nurse',
      credentialId: 'cred-1',
      grantedAt: '2026-06-01T00:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'RoleGranted', grantId: 'grant-1', staffId: 'nurse-1', role: 'charge-nurse', credentialId: 'cred-1', grantedAt: '2026-06-01T00:00:00.000Z' },
    ]);
  });

  it('rejects granting the same grantId twice', () => {
    const context: NursingContext = {
      ...contextWithValidCredential,
      roleGrants: {
        'grant-1': { grantId: roleGrantId('grant-1'), staffId: staffId('nurse-1'), role: 'charge-nurse', credentialId: credentialId('cred-1'), grantedAt: isoTimestamp('2026-06-01T00:00:00.000Z') },
      },
    };

    const result = grantRoleHandler(context, {
      kind: 'GrantRole',
      grantId: roleGrantId('grant-1'),
      staffId: staffId('nurse-1'),
      role: 'charge-nurse',
      credentialId: credentialId('cred-1'),
      grantedAt: isoTimestamp('2026-06-02T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'GrantAlreadyExists', grantId: 'grant-1' } });
  });

  it('rejects a grant referencing a credential that does not exist', () => {
    const result = grantRoleHandler(
      { credentials: {}, roleGrants: {} },
      { kind: 'GrantRole', grantId: roleGrantId('grant-1'), staffId: staffId('nurse-1'), role: 'charge-nurse', credentialId: credentialId('cred-1'), grantedAt: isoTimestamp('2026-06-01T00:00:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'CredentialNotFound', credentialId: 'cred-1' } });
  });

  it('rejects a grant where the credential belongs to a different staff member', () => {
    const result = grantRoleHandler(contextWithValidCredential, {
      kind: 'GrantRole',
      grantId: roleGrantId('grant-1'),
      staffId: staffId('nurse-2'), // cred-1 belongs to nurse-1
      role: 'charge-nurse',
      credentialId: credentialId('cred-1'),
      grantedAt: isoTimestamp('2026-06-01T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'CredentialStaffMismatch', grantId: 'grant-1', credentialId: 'cred-1' } });
  });

  it('rejects a grant backed by a revoked credential', () => {
    const revokedContext: NursingContext = {
      credentials: {
        'cred-1': { ...contextWithValidCredential.credentials['cred-1']!, status: 'revoked', revokedAt: isoTimestamp('2026-03-01T00:00:00.000Z') },
      },
      roleGrants: {},
    };

    const result = grantRoleHandler(revokedContext, {
      kind: 'GrantRole',
      grantId: roleGrantId('grant-1'),
      staffId: staffId('nurse-1'),
      role: 'charge-nurse',
      credentialId: credentialId('cred-1'),
      grantedAt: isoTimestamp('2026-06-01T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'CredentialRevoked', grantId: 'grant-1', credentialId: 'cred-1' } });
  });

  it('rejects a grant made after the credential has expired', () => {
    const result = grantRoleHandler(contextWithValidCredential, {
      kind: 'GrantRole',
      grantId: roleGrantId('grant-1'),
      staffId: staffId('nurse-1'),
      role: 'charge-nurse',
      credentialId: credentialId('cred-1'),
      grantedAt: isoTimestamp('2027-06-01T00:00:00.000Z'), // after 2027-01-01 expiresAt
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'CredentialExpired', grantId: 'grant-1', credentialId: 'cred-1', expiresAt: '2027-01-01T00:00:00.000Z', grantedAt: '2027-06-01T00:00:00.000Z' },
    });
  });

  it('rejects a grant made at the exact moment of expiry — half-open, not inclusive', () => {
    const result = grantRoleHandler(contextWithValidCredential, {
      kind: 'GrantRole',
      grantId: roleGrantId('grant-1'),
      staffId: staffId('nurse-1'),
      role: 'charge-nurse',
      credentialId: credentialId('cred-1'),
      grantedAt: isoTimestamp('2027-01-01T00:00:00.000Z'), // exactly expiresAt
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.error.kind).toBe('CredentialExpired');
  });

  it('accepts a grant made one millisecond before expiry', () => {
    const result = grantRoleHandler(contextWithValidCredential, {
      kind: 'GrantRole',
      grantId: roleGrantId('grant-1'),
      staffId: staffId('nurse-1'),
      role: 'charge-nurse',
      credentialId: credentialId('cred-1'),
      grantedAt: isoTimestamp('2026-12-31T23:59:59.999Z'),
    });

    expect(result.ok).toBe(true);
  });
});
