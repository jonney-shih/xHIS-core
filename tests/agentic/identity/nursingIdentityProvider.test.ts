import { describe, expect, it } from 'vitest';
import { createNursingIdentityProvider } from '../../../src/agentic/identity/nursingIdentityProvider.js';
import { credentialId, isoTimestamp, roleGrantId, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingContext } from '../../../src/instructions/nursing/types.js';

const context: NursingContext = {
  credentials: {
    'cred-active': {
      credentialId: credentialId('cred-active'),
      staffId: staffId('nurse-1'),
      credentialType: 'Charge-Nurse-Cert',
      status: 'active',
      issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
      expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z'),
    },
    'cred-revoked': {
      credentialId: credentialId('cred-revoked'),
      staffId: staffId('nurse-1'),
      credentialType: 'ACLS',
      status: 'revoked',
      issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
      expiresAt: isoTimestamp('2028-01-01T00:00:00.000Z'),
      revokedAt: isoTimestamp('2026-06-01T00:00:00.000Z'),
    },
  },
  roleGrants: {
    'grant-charge-nurse': {
      grantId: roleGrantId('grant-charge-nurse'),
      staffId: staffId('nurse-1'),
      role: 'charge-nurse',
      credentialId: credentialId('cred-active'),
      grantedAt: isoTimestamp('2026-02-01T00:00:00.000Z'),
    },
    'grant-acls': {
      grantId: roleGrantId('grant-acls'),
      staffId: staffId('nurse-1'),
      role: 'acls-provider',
      credentialId: credentialId('cred-revoked'),
      grantedAt: isoTimestamp('2026-02-01T00:00:00.000Z'), // granted while cred-revoked was still active
    },
  },
};

describe('createNursingIdentityProvider', () => {
  it('resolves an identity with only the roles currently backed by a valid credential', () => {
    const provider = createNursingIdentityProvider(context);

    const identity = provider.resolve('nurse-1', '2026-07-01T00:00:00.000Z');

    // cred-active is still valid; cred-revoked was revoked 2026-06-01,
    // before this asOf — acls-provider must not appear.
    expect(identity).toEqual({ id: 'nurse-1', displayName: 'nurse-1', roles: ['charge-nurse'] });
  });

  it('is genuinely time-varying: the same identity resolves differently before and after a credential expires', () => {
    const provider = createNursingIdentityProvider(context);

    const beforeExpiry = provider.resolve('nurse-1', '2026-12-31T00:00:00.000Z');
    expect(beforeExpiry?.roles).toContain('charge-nurse');

    const afterExpiry = provider.resolve('nurse-1', '2027-06-01T00:00:00.000Z');
    expect(afterExpiry?.roles).not.toContain('charge-nurse');
  });

  it('includes a role granted before its backing credential was later revoked, when asked about a moment before the revocation', () => {
    const provider = createNursingIdentityProvider(context);

    // asOf is before cred-revoked's own revokedAt (2026-06-01) — the
    // grant was valid at that moment, a retrospective audit query
    // should say so, even though the credential is revoked *now*.
    const identity = provider.resolve('nurse-1', '2026-03-01T00:00:00.000Z');

    expect(identity?.roles).toEqual(expect.arrayContaining(['charge-nurse', 'acls-provider']));
  });

  it('excludes a role once its backing credential has been revoked, for any asOf after the revocation', () => {
    const provider = createNursingIdentityProvider(context);

    const identity = provider.resolve('nurse-1', '2026-07-01T00:00:00.000Z');

    expect(identity?.roles).not.toContain('acls-provider');
  });

  it('returns undefined for a staff member who has never appeared in any role grant', () => {
    const provider = createNursingIdentityProvider(context);

    expect(provider.resolve('nurse-99', '2026-07-01T00:00:00.000Z')).toBeUndefined();
  });

  it('returns an identity with an empty roles list, not undefined, for a staff member whose only grants are all currently invalid', () => {
    const allExpiredContext: NursingContext = {
      credentials: {
        'cred-1': {
          credentialId: credentialId('cred-1'),
          staffId: staffId('nurse-2'),
          credentialType: 'BLS',
          status: 'active',
          issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
          expiresAt: isoTimestamp('2026-02-01T00:00:00.000Z'),
        },
      },
      roleGrants: {
        'grant-1': {
          grantId: roleGrantId('grant-1'),
          staffId: staffId('nurse-2'),
          role: 'bls-provider',
          credentialId: credentialId('cred-1'),
          grantedAt: isoTimestamp('2026-01-15T00:00:00.000Z'),
        },
      },
    };

    const provider = createNursingIdentityProvider(allExpiredContext);

    // Long after cred-1 expired — the identity is known (it has a
    // grant on record), it just holds nothing currently valid, a
    // meaningfully different situation from "never seen at all."
    expect(provider.resolve('nurse-2', '2027-01-01T00:00:00.000Z')).toEqual({
      id: 'nurse-2',
      displayName: 'nurse-2',
      roles: [],
    });
  });
});
