import { describe, expect, it } from 'vitest';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/nursing.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { credentialId, isoTimestamp, roleGrantId, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingInstruction } from '../../../src/instructions/nursing/types.js';
import type { VerifyDecision } from '../../../src/agentic/verification/verifier.js';

function needsApproval(reasons: readonly string[]): Extract<VerifyDecision, { kind: 'needs-human-approval' }> {
  return { kind: 'needs-human-approval', reasons };
}

describe('deriveApprovalConfirmationPanel (nursing)', () => {
  it('summarizes a single IssueCredential instruction and carries the risk reasons and provenance through unchanged', () => {
    const proposal: PlanProposal<NursingInstruction> = {
      instructions: [
        { kind: 'IssueCredential', credentialId: credentialId('cred-1'), staffId: staffId('dr-lin'), credentialType: 'MD-License', issuedAt: isoTimestamp('2026-08-01T00:00:00.000Z'), expiresAt: isoTimestamp('2027-08-01T00:00:00.000Z') },
      ],
      rationale: 'issued per credentialing office record',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-01T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(["sequence contains an instruction at risk tier 'review-required'"]));

    expect(panel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        credentialIds: ['cred-1'],
        instructionSummary: ['IssueCredential — cred-1 / MD-License'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
    });
  });

  it('summarizes RevokeCredential and GrantRole distinctly from IssueCredential, and de-duplicates a repeated credentialId without merging distinct ones', () => {
    const proposal: PlanProposal<NursingInstruction> = {
      instructions: [
        { kind: 'IssueCredential', credentialId: credentialId('cred-1'), staffId: staffId('dr-lin'), credentialType: 'MD-License', issuedAt: isoTimestamp('2026-08-01T00:00:00.000Z'), expiresAt: isoTimestamp('2027-08-01T00:00:00.000Z') },
        { kind: 'GrantRole', grantId: roleGrantId('grant-1'), staffId: staffId('dr-lin'), role: 'physician', credentialId: credentialId('cred-1'), grantedAt: isoTimestamp('2026-08-01T00:05:00.000Z') },
        { kind: 'RevokeCredential', credentialId: credentialId('cred-2'), revokedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
      ],
      rationale: 'end-of-cycle credentialing batch',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-01T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval(['proposal contains 3 instructions, exceeding the auto-reviewable limit of 2']));

    expect(panel.props.credentialIds).toEqual(['cred-1', 'cred-2']); // deduplicated, not tripled
    expect(panel.props.instructionSummary).toEqual([
      'IssueCredential — cred-1 / MD-License',
      'GrantRole — grant-1 / physician / cred-1',
      'RevokeCredential — cred-2',
    ]);
  });

  it('never invents risk reasons — an empty reasons list stays empty, not a fabricated placeholder', () => {
    const proposal: PlanProposal<NursingInstruction> = {
      instructions: [{ kind: 'RevokeCredential', credentialId: credentialId('cred-1'), revokedAt: isoTimestamp('2026-08-01T00:00:00.000Z') }],
      rationale: 'test',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-08-01T00:00:00.000Z',
    };

    const panel = deriveApprovalConfirmationPanel(proposal, needsApproval([]));

    expect(panel.props.riskReasons).toEqual([]);
  });
});
