import { describe, expect, it } from 'vitest';
import { toPlanProposal } from '../../../src/agentic/planning/toPlanProposal.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { bedInstructionValidators } from '../../../src/agentic/validation/bed.js';
import { bedVerifier } from '../../../src/agentic/verification/bed.js';
import { bedRiskTiers } from '../../../src/agentic/risk/bed.js';
import { EXAMPLE_bedApprovalPolicy } from '../../../src/agentic/identity/bed.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { bedEngine } from '../../../src/instructions/bed/engine.js';
import { bedId, isoTimestamp } from '../../../src/instructions/bed/ids.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { BedContext, BedEffect, BedInstruction } from '../../../src/instructions/bed/types.js';

/**
 * Proves the full Plan -> Do -> Check -> Approve -> Act pipeline
 * genuinely works for bed, not just that the types compile — the second
 * domain besides `patient` (after `lab`) exercised through the whole
 * chain end to end.
 */
describe('bed agentic pipeline, end to end', () => {
  const contextWithAvailableBed: BedContext = {
    beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } },
  };

  it('a raw untrusted AssignBed candidate flows through validation, Do, Check, approval, and Act to a real commit', () => {
    const proposalResult = toPlanProposal<BedInstruction>(
      bedInstructionValidators,
      {
        instructions: [{ kind: 'AssignBed', bedId: 'bed-1', encounterId: 'encounter-1', assignedAt: '2026-07-22T00:00:00.000Z' }],
        rationale: 'assigned per bed board',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
      '2026-07-22T00:00:00.000Z',
    );
    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) throw new Error('expected ok');
    const proposal = proposalResult.value;

    const doOutcome = bedEngine.executeSequence(contextWithAvailableBed, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = bedVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'coord-lin', displayName: 'Lin (bed coordinator)', roles: ['bed-coordinator'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, bedRiskTiers, EXAMPLE_bedApprovalPolicy, proposal, {
      approverId: 'coord-lin',
      approved: true,
      decidedAt: '2026-07-22T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<BedContext, BedInstruction, BedEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      approval: resolution.approval,
      recordedAt: '2026-07-22T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.beds['bed-1']).toMatchObject({ bedId: 'bed-1', status: 'occupied', encounterId: 'encounter-1' });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      approval: { approverId: 'coord-lin', approverRole: 'bed-coordinator' },
    });
  });

  it('a malformed candidate never becomes a PlanProposal at all', () => {
    const proposalResult = toPlanProposal<BedInstruction>(
      bedInstructionValidators,
      {
        instructions: [{ kind: 'AssignBed', bedId: '' }],
        rationale: 'malformed',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
      '2026-07-22T00:00:00.000Z',
    );

    expect(proposalResult.ok).toBe(false);
  });

  it('a physician cannot approve AssignBed — bed review-required needs charge-nurse or bed-coordinator, not physician', () => {
    const assignBed: BedInstruction = {
      kind: 'AssignBed',
      bedId: bedId('bed-1'),
      encounterId: encounterId('encounter-1'),
      assignedAt: isoTimestamp('2026-07-22T00:00:00.000Z'),
    };
    const proposal: PlanProposal<BedInstruction> = {
      instructions: [assignBed],
      rationale: 'assigned per bed board',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-22T00:00:00.000Z',
    };

    const doOutcome = bedEngine.executeSequence(contextWithAvailableBed, proposal.instructions);
    const decision = bedVerifier.verify(proposal);
    expect(decision.kind).toBe('needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'dr-wu', displayName: 'Wu (attending)', roles: ['physician'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, bedRiskTiers, EXAMPLE_bedApprovalPolicy, proposal, {
      approverId: 'dr-wu',
      approved: true,
      decidedAt: '2026-07-22T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<BedContext, BedInstruction, BedEffect>();
    const outcome = act(shell, { proposal, doOutcome, decision, recordedAt: '2026-07-22T00:05:01.000Z' });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
