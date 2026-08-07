import { describe, expect, it } from 'vitest';
import { issueCredentialHandler } from '../../../src/instructions/nursing/handlers/issueCredential.js';
import { credentialId, isoTimestamp, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingContext } from '../../../src/instructions/nursing/types.js';

const emptyContext: NursingContext = { credentials: {}, roleGrants: {} };

describe('issueCredentialHandler', () => {
  it('issues a credential and emits a CredentialIssued effect', () => {
    const result = issueCredentialHandler(emptyContext, {
      kind: 'IssueCredential',
      credentialId: credentialId('cred-1'),
      staffId: staffId('nurse-1'),
      credentialType: 'ACLS',
      issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
      expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.credentials['cred-1']).toEqual({
      credentialId: 'cred-1',
      staffId: 'nurse-1',
      credentialType: 'ACLS',
      status: 'active',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      {
        kind: 'CredentialIssued',
        credentialId: 'cred-1',
        staffId: 'nurse-1',
        credentialType: 'ACLS',
        issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('never mutates the input context', () => {
    const before = JSON.stringify(emptyContext);

    issueCredentialHandler(emptyContext, {
      kind: 'IssueCredential',
      credentialId: credentialId('cred-1'),
      staffId: staffId('nurse-1'),
      credentialType: 'ACLS',
      issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
      expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z'),
    });

    expect(JSON.stringify(emptyContext)).toBe(before);
  });

  it('rejects issuing the same credentialId twice', () => {
    const context: NursingContext = {
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

    const result = issueCredentialHandler(context, {
      kind: 'IssueCredential',
      credentialId: credentialId('cred-1'),
      staffId: staffId('nurse-2'),
      credentialType: 'BLS',
      issuedAt: isoTimestamp('2026-02-01T00:00:00.000Z'),
      expiresAt: isoTimestamp('2027-02-01T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'CredentialAlreadyExists', credentialId: 'cred-1' } });
  });
});
