import { describe, expect, it } from 'vitest';
import { createCdssNursingPlanner } from '../../../src/agentic/planning/cdssNursingPlanner.js';
import type { CredentialRevocationReadySignal } from '../../../src/agentic/planning/cdssNursingPlanner.js';
import { credentialId, isoTimestamp, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingContext } from '../../../src/instructions/nursing/types.js';

const emptyNursingContext: NursingContext = { credentials: {}, roleGrants: {} };

describe('createCdssNursingPlanner', () => {
  it('recommends revocation for a signal whose credential is still active', async () => {
    const planner = createCdssNursingPlanner();
    const context: NursingContext = {
      credentials: {
        'cred-1': { credentialId: credentialId('cred-1'), staffId: staffId('dr-lin'), credentialType: 'MD-License', status: 'active', issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'), expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z') },
      },
      roleGrants: {},
    };
    const signal: CredentialRevocationReadySignal = { credentialId: credentialId('cred-1') };

    const result = await planner.plan(
      { description: 'credentialing office sweep' },
      { nursingContext: context, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      [],
    );

    expect(result).toEqual({
      ok: true,
      value: {
        instructions: [{ kind: 'RevokeCredential', credentialId: 'cred-1', revokedAt: '2026-08-01T01:00:00.000Z' }],
        rationale: 'CDSS nursing rule: recommending revocation for 1 signal(s) whose credential is still active',
        modelVersion: 'cdss-nursing-revocation-rule-engine-v1',
        promptVersion: 'nursing-revocation-ruleset-v1',
      },
    });
  });

  it('is idempotent: a signal for a credential already revoked produces no recommendation', async () => {
    const planner = createCdssNursingPlanner();
    const context: NursingContext = {
      credentials: {
        'cred-1': {
          credentialId: credentialId('cred-1'),
          staffId: staffId('dr-lin'),
          credentialType: 'MD-License',
          status: 'revoked',
          issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
          expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z'),
          revokedAt: isoTimestamp('2026-06-01T00:00:00.000Z'),
        },
      },
      roleGrants: {},
    };
    const signal: CredentialRevocationReadySignal = { credentialId: credentialId('cred-1') };

    const result = await planner.plan({ description: 'credentialing office sweep' }, { nursingContext: context, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  it('skips a signal naming a credentialId that does not exist at all', async () => {
    const planner = createCdssNursingPlanner();
    const signal: CredentialRevocationReadySignal = { credentialId: credentialId('cred-unknown') };

    const result = await planner.plan({ description: 'credentialing office sweep' }, { nursingContext: emptyNursingContext, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  /**
   * The nursing-specific counterpart to `createCdssPharmacyPlanner`'s
   * own "recommends dispensing at most once" test — arrived at for the
   * identical reason: two `RevokeCredential` instructions for the same
   * `credentialId` would doom the whole batch at Do time.
   */
  it('recommends revocation at most once even if the same credentialId is signaled twice in one batch', async () => {
    const planner = createCdssNursingPlanner();
    const context: NursingContext = {
      credentials: {
        'cred-1': { credentialId: credentialId('cred-1'), staffId: staffId('dr-lin'), credentialType: 'MD-License', status: 'active', issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'), expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z') },
      },
      roleGrants: {},
    };
    const signals: readonly CredentialRevocationReadySignal[] = [{ credentialId: credentialId('cred-1') }, { credentialId: credentialId('cred-1') }];

    const result = await planner.plan({ description: 'credentialing office sweep' }, { nursingContext: context, signals }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([
      { kind: 'RevokeCredential', credentialId: 'cred-1', revokedAt: '2026-08-01T01:00:00.000Z' },
    ]);
  });

  it('handles multiple independent signals for distinct credentials without any cross-signal interaction', async () => {
    const planner = createCdssNursingPlanner();
    const context: NursingContext = {
      credentials: {
        'cred-1': { credentialId: credentialId('cred-1'), staffId: staffId('dr-lin'), credentialType: 'MD-License', status: 'active', issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'), expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z') },
        'cred-2': { credentialId: credentialId('cred-2'), staffId: staffId('nurse-ho'), credentialType: 'RN-License', status: 'active', issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'), expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z') },
      },
      roleGrants: {},
    };
    const signals: readonly CredentialRevocationReadySignal[] = [{ credentialId: credentialId('cred-1') }, { credentialId: credentialId('cred-2') }];

    const result = await planner.plan({ description: 'credentialing office sweep' }, { nursingContext: context, signals }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([
      { kind: 'RevokeCredential', credentialId: 'cred-1', revokedAt: '2026-08-01T01:00:00.000Z' },
      { kind: 'RevokeCredential', credentialId: 'cred-2', revokedAt: '2026-08-01T01:00:00.000Z' },
    ]);
  });

  it('ignores feedback — the rule is a pure function of context and signals, not of prior attempts', async () => {
    const planner = createCdssNursingPlanner();
    const context: NursingContext = {
      credentials: { 'cred-1': { credentialId: credentialId('cred-1'), staffId: staffId('dr-lin'), credentialType: 'MD-License', status: 'active', issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'), expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z') } },
      roleGrants: {},
    };
    const signal: CredentialRevocationReadySignal = { credentialId: credentialId('cred-1') };

    const first = await planner.plan({ description: 'credentialing office sweep' }, { nursingContext: context, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);
    const second = await planner.plan(
      { description: 'credentialing office sweep' },
      { nursingContext: context, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      ['some prior feedback that a deterministic rule has no way to act on'],
    );

    expect(first).toEqual(second);
  });
});
