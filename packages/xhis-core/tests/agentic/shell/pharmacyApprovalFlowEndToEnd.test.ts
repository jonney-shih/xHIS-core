import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { pharmacyVerifier } from '../../../src/agentic/verification/pharmacy.js';
import { pharmacyRiskTiers } from '../../../src/agentic/risk/pharmacy.js';
import { EXAMPLE_pharmacyApprovalPolicy } from '../../../src/agentic/identity/pharmacy.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/pharmacy.js';
import { createInMemoryUiProposalTelemetryLog } from '../../../src/agentic/ui/telemetry.js';
import { pharmacyEngine } from '../../../src/instructions/pharmacy/engine.js';
import { encounterId, isoTimestamp, prescriptionId } from '../../../src/instructions/pharmacy/ids.js';
import type { PharmacyContext, PharmacyEffect, PharmacyInstruction } from '../../../src/instructions/pharmacy/types.js';

const emptyPharmacyContext: PharmacyContext = { prescriptions: {} };

const prescribe: PharmacyInstruction = {
  kind: 'PrescribeMedication',
  prescriptionId: prescriptionId('rx-1'),
  encounterId: encounterId('encounter-1'),
  medicationCode: 'AMOX-500',
  prescribedAt: isoTimestamp('2026-07-31T00:00:00.000Z'),
};

const prescribedContext: PharmacyContext = {
  prescriptions: { 'rx-1': { prescriptionId: prescriptionId('rx-1'), encounterId: encounterId('encounter-1'), medicationCode: 'AMOX-500', status: 'prescribed', prescribedAt: isoTimestamp('2026-07-31T00:00:00.000Z') } },
};

const dispense: PharmacyInstruction = {
  kind: 'DispenseMedication',
  prescriptionId: prescriptionId('rx-1'),
  dispensedAt: isoTimestamp('2026-07-31T01:00:00.000Z'),
};

const prescribeProposal: PlanProposal<PharmacyInstruction> = {
  instructions: [prescribe],
  rationale: 'prescribed per attending order',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-07-31T00:00:00.000Z',
};

const dispenseProposal: PlanProposal<PharmacyInstruction> = {
  instructions: [dispense],
  rationale: 'dispensed per pharmacy queue',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-07-31T01:00:00.000Z',
};

/**
 * The pharmacy-domain counterpart to `bedApprovalFlowEndToEnd.test.ts`'s
 * and `labApprovalFlowEndToEnd.test.ts`'s real approval flows — same
 * wiring, hand-constructed proposals for the identical reason those
 * files document (no CDSS/LLM planner exists for pharmacy either).
 * Pharmacy's `EXAMPLE_pharmacyApprovalPolicy` inverts lab's role shape:
 * lab's top tier is `physician`-only, pharmacy's is `pharmacist`-only —
 * so this file proves the risk-tier -> required-role lookup discriminates
 * with a *different* top-tier role, not just that pharmacy happens to
 * reuse the same one.
 */
describe('pharmacy domain approval flow, end to end', () => {
  it('a physician may approve a PrescribeMedication (review-required), and it commits', () => {
    const doOutcome = pharmacyEngine.executeSequence(emptyPharmacyContext, prescribeProposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = pharmacyVerifier.verify(prescribeProposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const telemetryLog = createInMemoryUiProposalTelemetryLog();
    const approvalPanel = deriveApprovalConfirmationPanel(prescribeProposal, decision);
    telemetryLog.record({ component: approvalPanel.component, outcome: 'rendered', reasons: decision.reasons, recordedAt: '2026-07-31T00:04:59.000Z' });
    expect(approvalPanel.props.prescriptionIds).toEqual(['rx-1']);

    const identityProvider = createInMemoryIdentityProvider([{ id: 'dr-lin', displayName: 'Dr. Lin', roles: ['physician'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, pharmacyRiskTiers, EXAMPLE_pharmacyApprovalPolicy, prescribeProposal, {
      approverId: 'dr-lin',
      approved: true,
      decidedAt: '2026-07-31T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<PharmacyContext, PharmacyInstruction, PharmacyEffect>();
    const outcome = act(shell, {
      proposal: prescribeProposal,
      doOutcome,
      decision,
      baselineContext: emptyPharmacyContext,
      reexecute: (ctx) => pharmacyEngine.executeSequence(ctx, prescribeProposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-07-31T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({ commitOutcome: 'committed', approval: { approverId: 'dr-lin', approverRole: 'physician' } });
  });

  it('the same physician may NOT approve a DispenseMedication (approval-required) — pharmacist-only, and nothing commits', () => {
    const doOutcome = pharmacyEngine.executeSequence(prescribedContext, dispenseProposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = pharmacyVerifier.verify(dispenseProposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([{ id: 'dr-lin', displayName: 'Dr. Lin', roles: ['physician'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, pharmacyRiskTiers, EXAMPLE_pharmacyApprovalPolicy, dispenseProposal, {
      approverId: 'dr-lin',
      approved: true,
      decidedAt: '2026-07-31T01:05:00.000Z',
    });
    // Not impersonation this time -- a real, resolvable identity, just
    // one that doesn't hold a sufficient role for *this* tier.
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<PharmacyContext, PharmacyInstruction, PharmacyEffect>();
    const outcome = act(shell, {
      proposal: dispenseProposal,
      doOutcome,
      decision,
      baselineContext: prescribedContext,
      reexecute: (ctx) => pharmacyEngine.executeSequence(ctx, dispenseProposal.instructions),
      recordedAt: '2026-07-31T01:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });

  it('a pharmacist may approve the same DispenseMedication a physician could not, and it commits', () => {
    const doOutcome = pharmacyEngine.executeSequence(prescribedContext, dispenseProposal.instructions);
    const decision = pharmacyVerifier.verify(dispenseProposal);
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([{ id: 'rph-tan', displayName: 'Tan (pharmacist)', roles: ['pharmacist'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, pharmacyRiskTiers, EXAMPLE_pharmacyApprovalPolicy, dispenseProposal, {
      approverId: 'rph-tan',
      approved: true,
      decidedAt: '2026-07-31T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<PharmacyContext, PharmacyInstruction, PharmacyEffect>();
    const outcome = act(shell, {
      proposal: dispenseProposal,
      doOutcome,
      decision,
      baselineContext: prescribedContext,
      reexecute: (ctx) => pharmacyEngine.executeSequence(ctx, dispenseProposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-07-31T01:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
  });
});
