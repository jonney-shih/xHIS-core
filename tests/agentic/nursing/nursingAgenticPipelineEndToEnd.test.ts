import { describe, expect, it } from 'vitest';
import { toPlanProposal } from '../../../src/agentic/planning/toPlanProposal.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { nursingInstructionValidators } from '../../../src/agentic/validation/nursing.js';
import { nursingVerifier } from '../../../src/agentic/verification/nursing.js';
import { nursingRiskTiers } from '../../../src/agentic/risk/nursing.js';
import { EXAMPLE_nursingApprovalPolicy } from '../../../src/agentic/identity/nursing.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { createNursingIdentityProvider } from '../../../src/agentic/identity/nursingIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { nursingEngine } from '../../../src/instructions/nursing/engine.js';
import { credentialId, isoTimestamp, roleGrantId, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingContext, NursingEffect, NursingInstruction } from '../../../src/instructions/nursing/types.js';

/**
 * Proves the full Plan -> Do -> Check -> Approve -> Act pipeline
 * genuinely works for nursing, not just that the types compile — the
 * sixth, and last, domain besides `patient` exercised through the whole
 * chain end to end.
 */
describe('nursing agentic pipeline, end to end', () => {
  const emptyNursingContext: NursingContext = { credentials: {}, roleGrants: {} };

  it('a raw untrusted IssueCredential candidate flows through validation, Do, Check, approval, and Act to a real commit', () => {
    const proposalResult = toPlanProposal<NursingInstruction>(
      nursingInstructionValidators,
      {
        instructions: [
          {
            kind: 'IssueCredential',
            credentialId: 'cred-1',
            staffId: 'dr-lin',
            credentialType: 'MD-License',
            issuedAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2027-01-01T00:00:00.000Z',
          },
        ],
        rationale: 'issued per credentialing office record',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
      '2026-01-01T00:00:00.000Z',
    );
    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) throw new Error('expected ok');
    const proposal = proposalResult.value;

    const doOutcome = nursingEngine.executeSequence(emptyNursingContext, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = nursingVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'officer-tsai', displayName: 'Tsai (credentialing office)', roles: ['credentialing-officer'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, nursingRiskTiers, EXAMPLE_nursingApprovalPolicy, proposal, {
      approverId: 'officer-tsai',
      approved: true,
      decidedAt: '2026-01-01T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<NursingContext, NursingInstruction, NursingEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: emptyNursingContext,
      reexecute: (ctx) => nursingEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-01-01T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.credentials['cred-1']).toMatchObject({ credentialId: 'cred-1', status: 'active' });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      approval: { approverId: 'officer-tsai', approverRole: 'credentialing-officer' },
    });
  });

  it('a malformed candidate never becomes a PlanProposal at all', () => {
    const proposalResult = toPlanProposal<NursingInstruction>(
      nursingInstructionValidators,
      {
        instructions: [{ kind: 'IssueCredential', credentialId: '' }],
        rationale: 'malformed',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
      '2026-01-01T00:00:00.000Z',
    );

    expect(proposalResult.ok).toBe(false);
  });

  it('a GrantRole approval is resolved against nursing\'s own committed state, not a hand-maintained list — and a credentialing officer\'s real role still cannot clear it', () => {
    const officerCredentialId = credentialId('cred-officer');
    const officerGrantId = roleGrantId('grant-officer');
    const tsaiCredentialId = credentialId('cred-tsai');
    const drLinCredentialId = credentialId('cred-dr-lin');

    // The context this test uses for two different purposes at once:
    // Do's baseline/latest state, *and* what backs the approver's own
    // identity via `createNursingIdentityProvider` — proving nursing's
    // agentic pipeline can be authorized from its own domain state,
    // closing the loop `nursingIdentityProvider.ts`'s doc comment
    // describes, this time for nursing's *own* instructions rather than
    // patient's (see `nursingIdentityProviderApprovalFlow.test.ts`).
    const baseline: NursingContext = {
      credentials: {
        'cred-officer': {
          credentialId: officerCredentialId,
          staffId: staffId('officer-lin'),
          credentialType: 'CMO-Appointment',
          status: 'active',
          issuedAt: isoTimestamp('2025-01-01T00:00:00.000Z'),
          expiresAt: isoTimestamp('2030-01-01T00:00:00.000Z'),
        },
        'cred-tsai': {
          credentialId: tsaiCredentialId,
          staffId: staffId('officer-tsai'),
          credentialType: 'Credentialing-Office-Appointment',
          status: 'active',
          issuedAt: isoTimestamp('2025-01-01T00:00:00.000Z'),
          expiresAt: isoTimestamp('2030-01-01T00:00:00.000Z'),
        },
        'cred-dr-lin': {
          credentialId: drLinCredentialId,
          staffId: staffId('dr-lin'),
          credentialType: 'MD-License',
          status: 'active',
          issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
          expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z'),
        },
      },
      roleGrants: {
        'grant-officer': {
          grantId: officerGrantId,
          staffId: staffId('officer-lin'),
          role: 'chief-medical-officer',
          credentialId: officerCredentialId,
          grantedAt: isoTimestamp('2025-01-02T00:00:00.000Z'),
        },
        'grant-tsai': {
          grantId: roleGrantId('grant-tsai'),
          staffId: staffId('officer-tsai'),
          role: 'credentialing-officer',
          credentialId: tsaiCredentialId,
          grantedAt: isoTimestamp('2025-01-02T00:00:00.000Z'),
        },
      },
    };

    const grantRole: NursingInstruction = {
      kind: 'GrantRole',
      grantId: roleGrantId('grant-dr-lin'),
      staffId: staffId('dr-lin'),
      role: 'physician',
      credentialId: drLinCredentialId,
      grantedAt: isoTimestamp('2026-02-01T00:00:00.000Z'),
    };
    const proposal: PlanProposal<NursingInstruction> = {
      instructions: [grantRole],
      rationale: 'physician role granted per medical staff privileging',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-02-01T00:00:00.000Z',
    };

    const doOutcome = nursingEngine.executeSequence(baseline, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = nursingVerifier.verify(proposal);
    expect(decision.kind).toBe('needs-human-approval');

    // The approver's identity is derived from `baseline` itself, not a
    // fixed test-only list.
    const identityProvider = createNursingIdentityProvider(baseline);

    const cmoResolution = resolveApprovalForProposal(identityProvider, nursingRiskTiers, EXAMPLE_nursingApprovalPolicy, proposal, {
      approverId: 'officer-lin',
      approved: true,
      decidedAt: '2026-02-01T00:05:00.000Z',
    });
    expect(cmoResolution.kind).toBe('resolved');
    if (cmoResolution.kind !== 'resolved') throw new Error('expected resolved');
    expect(cmoResolution.approval.approverRole).toBe('chief-medical-officer');

    const shell = createInMemoryShell<NursingContext, NursingInstruction, NursingEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: baseline,
      reexecute: (ctx) => nursingEngine.executeSequence(ctx, proposal.instructions),
      approval: cmoResolution.approval,
      recordedAt: '2026-02-01T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits[0]!.context.roleGrants['grant-dr-lin']).toMatchObject({ staffId: 'dr-lin', role: 'physician' });

    // officer-tsai is a real, known identity in this same nursing state
    // — holding a genuinely valid `credentialing-officer` grant, enough
    // to clear `review-required` — but that role is not in
    // approval-required's list, so resolution fails on role
    // insufficiency specifically, not on an unknown approver.
    const unresolved = resolveApprovalForProposal(identityProvider, nursingRiskTiers, EXAMPLE_nursingApprovalPolicy, proposal, {
      approverId: 'officer-tsai',
      approved: true,
      decidedAt: '2026-02-01T00:05:00.000Z',
    });
    expect(unresolved).toEqual({
      kind: 'unresolved',
      reason: "identity 'officer-tsai' holds none of the required roles [chief-medical-officer]",
    });
  });
});
