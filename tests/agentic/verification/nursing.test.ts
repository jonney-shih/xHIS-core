import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { nursingVerifier } from '../../../src/agentic/verification/nursing.js';
import { credentialId, isoTimestamp, roleGrantId, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingInstruction } from '../../../src/instructions/nursing/types.js';

const issueCredential: NursingInstruction = {
  kind: 'IssueCredential',
  credentialId: credentialId('cred-1'),
  staffId: staffId('dr-lin'),
  credentialType: 'MD-License',
  issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
  expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z'),
};

const grantRole: NursingInstruction = {
  kind: 'GrantRole',
  grantId: roleGrantId('grant-1'),
  staffId: staffId('dr-lin'),
  role: 'physician',
  credentialId: credentialId('cred-1'),
  grantedAt: isoTimestamp('2026-02-01T00:00:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<NursingInstruction>> = {}): PlanProposal<NursingInstruction> {
  return {
    instructions: [issueCredential],
    rationale: 'issued per credentialing office record',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('nursingVerifier', () => {
  it('needs human approval for IssueCredential, via risk tier alone', () => {
    expect(nursingVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it('needs human approval for GrantRole too, at its own (higher) tier', () => {
    expect(nursingVerifier.verify(proposal({ instructions: [grantRole] }))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = nursingVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });

  it('flags a batch larger than NURSING_MAX_BATCH_SIZE for human approval', () => {
    const oversized = new Array(21).fill(issueCredential);
    const result = nursingVerifier.verify(proposal({ instructions: oversized }));

    expect(result.kind).toBe('needs-human-approval');
  });
});
