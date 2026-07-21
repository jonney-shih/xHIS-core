import { describe, expect, it } from 'vitest';
import { nursingInstructionValidators } from '../../../src/agentic/validation/nursing.js';
import { validateInstruction } from '../../../src/agentic/validation/validator.js';

describe('nursingInstructionValidators', () => {
  it('accepts a well-formed IssueCredential candidate and brands its fields', () => {
    const result = validateInstruction(nursingInstructionValidators, {
      kind: 'IssueCredential',
      credentialId: 'cred-1',
      staffId: 'dr-lin',
      credentialType: 'MD-License',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'IssueCredential',
        credentialId: 'cred-1',
        staffId: 'dr-lin',
        credentialType: 'MD-License',
        issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00.000Z',
      },
    });
  });

  it('accepts a well-formed RevokeCredential candidate', () => {
    const result = validateInstruction(nursingInstructionValidators, {
      kind: 'RevokeCredential',
      credentialId: 'cred-1',
      revokedAt: '2026-07-22T00:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'RevokeCredential', credentialId: 'cred-1', revokedAt: '2026-07-22T00:00:00.000Z' },
    });
  });

  it('accepts a well-formed GrantRole candidate', () => {
    const result = validateInstruction(nursingInstructionValidators, {
      kind: 'GrantRole',
      grantId: 'grant-1',
      staffId: 'dr-lin',
      role: 'physician',
      credentialId: 'cred-1',
      grantedAt: '2026-02-01T00:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'GrantRole',
        grantId: 'grant-1',
        staffId: 'dr-lin',
        role: 'physician',
        credentialId: 'cred-1',
        grantedAt: '2026-02-01T00:00:00.000Z',
      },
    });
  });

  it('rejects a candidate missing required fields, reporting every issue', () => {
    const result = validateInstruction(nursingInstructionValidators, {
      kind: 'IssueCredential',
      credentialId: '',
    });

    expect(result).toEqual({
      ok: false,
      error: [
        "'credentialId' must be a non-empty string",
        "'staffId' must be a non-empty string",
        "'credentialType' must be a non-empty string",
        "'issuedAt' must be an ISO-8601 timestamp string",
        "'expiresAt' must be an ISO-8601 timestamp string",
      ],
    });
  });

  it('rejects a timestamp that is not ISO-8601 shaped', () => {
    const result = validateInstruction(nursingInstructionValidators, {
      kind: 'RevokeCredential',
      credentialId: 'cred-1',
      revokedAt: 'yesterday',
    });

    expect(result).toEqual({ ok: false, error: ["'revokedAt' must be an ISO-8601 timestamp string"] });
  });

  it('rejects an unknown instruction kind', () => {
    const result = validateInstruction(nursingInstructionValidators, { kind: 'RevokeRoleGrant', grantId: 'grant-1' });

    expect(result).toEqual({ ok: false, error: ["unknown instruction kind 'RevokeRoleGrant'"] });
  });
});
