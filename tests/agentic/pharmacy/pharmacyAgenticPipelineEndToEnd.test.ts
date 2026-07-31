import { describe, expect, it } from 'vitest';
import { toPlanProposal } from '../../../src/agentic/planning/toPlanProposal.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { pharmacyInstructionValidators } from '../../../src/agentic/validation/pharmacy.js';
import { pharmacyVerifier } from '../../../src/agentic/verification/pharmacy.js';
import { pharmacyRiskTiers } from '../../../src/agentic/risk/pharmacy.js';
import { EXAMPLE_pharmacyApprovalPolicy } from '../../../src/agentic/identity/pharmacy.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { pharmacyEngine } from '../../../src/instructions/pharmacy/engine.js';
import { encounterId, isoTimestamp, prescriptionId } from '../../../src/instructions/pharmacy/ids.js';
import type { PharmacyContext, PharmacyEffect, PharmacyInstruction } from '../../../src/instructions/pharmacy/types.js';

/**
 * Proves the full Plan -> Do -> Check -> Approve -> Act pipeline
 * genuinely works for pharmacy, not just that the types compile — the
 * fourth domain (after patient, lab, and bed) exercised through the
 * whole chain end to end.
 */
describe('pharmacy agentic pipeline, end to end', () => {
  const emptyPharmacyContext: PharmacyContext = { prescriptions: {} };

  it('a raw untrusted PrescribeMedication candidate flows through validation, Do, Check, approval, and Act to a real commit', () => {
    const proposalResult = toPlanProposal<PharmacyInstruction>(
      pharmacyInstructionValidators,
      {
        instructions: [{ kind: 'PrescribeMedication', prescriptionId: 'rx-1', encounterId: 'encounter-1', medicationCode: 'AMOX-500', prescribedAt: '2026-07-31T00:00:00.000Z' }],
        rationale: 'prescribed per attending order',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
      '2026-07-31T00:00:00.000Z',
    );
    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) throw new Error('expected ok');
    const proposal = proposalResult.value;

    const doOutcome = pharmacyEngine.executeSequence(emptyPharmacyContext, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = pharmacyVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'rph-tan', displayName: 'Tan (pharmacist)', roles: ['pharmacist'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, pharmacyRiskTiers, EXAMPLE_pharmacyApprovalPolicy, proposal, {
      approverId: 'rph-tan',
      approved: true,
      decidedAt: '2026-07-31T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<PharmacyContext, PharmacyInstruction, PharmacyEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: emptyPharmacyContext,
      reexecute: (ctx) => pharmacyEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-07-31T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.prescriptions['rx-1']).toMatchObject({ prescriptionId: 'rx-1', status: 'prescribed', encounterId: 'encounter-1', medicationCode: 'AMOX-500' });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      approval: { approverId: 'rph-tan', approverRole: 'pharmacist' },
    });
  });

  it('a malformed candidate never becomes a PlanProposal at all', () => {
    const proposalResult = toPlanProposal<PharmacyInstruction>(
      pharmacyInstructionValidators,
      {
        instructions: [{ kind: 'PrescribeMedication', prescriptionId: '' }],
        rationale: 'malformed',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
      '2026-07-31T00:00:00.000Z',
    );

    expect(proposalResult.ok).toBe(false);
  });

  it('a nurse cannot approve PrescribeMedication — pharmacy review-required needs physician or pharmacist, not nurse', () => {
    const prescribe: PharmacyInstruction = {
      kind: 'PrescribeMedication',
      prescriptionId: prescriptionId('rx-1'),
      encounterId: encounterId('encounter-1'),
      medicationCode: 'AMOX-500',
      prescribedAt: isoTimestamp('2026-07-31T00:00:00.000Z'),
    };
    const proposal: PlanProposal<PharmacyInstruction> = {
      instructions: [prescribe],
      rationale: 'prescribed per attending order',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-31T00:00:00.000Z',
    };

    const doOutcome = pharmacyEngine.executeSequence(emptyPharmacyContext, proposal.instructions);
    const decision = pharmacyVerifier.verify(proposal);
    expect(decision.kind).toBe('needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'nurse-ho', displayName: 'Ho (nurse)', roles: ['nurse'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, pharmacyRiskTiers, EXAMPLE_pharmacyApprovalPolicy, proposal, {
      approverId: 'nurse-ho',
      approved: true,
      decidedAt: '2026-07-31T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<PharmacyContext, PharmacyInstruction, PharmacyEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: emptyPharmacyContext,
      reexecute: (ctx) => pharmacyEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-07-31T00:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
