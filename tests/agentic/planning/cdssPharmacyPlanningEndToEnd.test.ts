import { describe, expect, it } from 'vitest';
import { createCdssPharmacyPlanner } from '../../../src/agentic/planning/cdssPharmacyPlanner.js';
import type { CdssPharmacyContext, PharmacyDispenseReadySignal } from '../../../src/agentic/planning/cdssPharmacyPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { pharmacyInstructionValidators } from '../../../src/agentic/validation/pharmacy.js';
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

const contextWithPrescribedRx: PharmacyContext = {
  prescriptions: {
    'rx-1': { prescriptionId: prescriptionId('rx-1'), encounterId: encounterId('encounter-1'), medicationCode: 'AMOX-500', status: 'prescribed', prescribedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
  },
};

/**
 * The pharmacy-domain counterpart to `cdssBedPlanningEndToEnd.test.ts`
 * and `cdssLabPlanningEndToEnd.test.ts` — same `planWithRetries` ->
 * `toPlanProposal` -> Do -> Check -> approval -> Act pipeline, now
 * driven by `createCdssPharmacyPlanner`. Does not repeat the
 * `suggestVitalsEntryPanel`/`resolveUiRenderOutcome` tests for the same
 * reason bed's and lab's own end-to-end files don't: no Agent-selected
 * UI component exists for pharmacy, and building one now, unasked,
 * would be guessing at a scenario rather than proving one.
 */
describe('CDSS pharmacy-dispense planning path, end to end', () => {
  it('retrying a deterministic rule against an unchanging bad timestamp produces the identical failure every attempt, unlike an LLM recovering from feedback', async () => {
    // Same reasoning `cdssLabPlanningEndToEnd.test.ts`'s own retry test
    // gives: a malformed *signal* can't taint the output here either —
    // `signal.prescriptionId` only ever reaches the output after being
    // matched against a real, already-valid `prescriptionId` key in
    // `context.pharmacyContext.prescriptions` (see
    // `cdssPharmacyPlanner.ts`'s own filter), so an unknown or malformed
    // one is filtered out, not propagated. `proposedAt` is the one input
    // that flows straight into `dispensedAt` unvalidated, and
    // `planWithRetries` passes the same one to every attempt.
    const signal: PharmacyDispenseReadySignal = { prescriptionId: prescriptionId('rx-1') };
    const planner = createCdssPharmacyPlanner();

    // Explicit type arguments: same mapped-type inference limitation
    // `createEngine` call sites already document (see `pharmacy/engine.ts`).
    const result = await planWithRetries<CdssPharmacyContext, PharmacyInstruction>(
      planner,
      pharmacyInstructionValidators,
      { description: 'pharmacy queue sweep' },
      { pharmacyContext: contextWithPrescribedRx, signals: [signal] },
      'not-a-timestamp',
      3,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.attempts).toBe(3);
    expect(result.error.issues).toEqual(["instruction 0: 'dispensedAt' must be an ISO-8601 timestamp string"]);
  });

  it('a CDSS-recommended dispense is not exempt from risk-tiered human approval, and commits only once a permitted identity approves', async () => {
    const signal: PharmacyDispenseReadySignal = { prescriptionId: prescriptionId('rx-1') };
    const planner = createCdssPharmacyPlanner();

    const planResult = await planWithRetries<CdssPharmacyContext, PharmacyInstruction>(
      planner,
      pharmacyInstructionValidators,
      { description: 'pharmacy queue sweep' },
      { pharmacyContext: contextWithPrescribedRx, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    // Do — against the real, plain `PharmacyContext`, entirely decoupled
    // from `CdssPharmacyContext`: Do/Check/Act never know or care that
    // this proposal came from a rule engine rather than a model.
    const doOutcome = pharmacyEngine.executeSequence(contextWithPrescribedRx, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    // Check — the same `pharmacyVerifier` an LLM-sourced proposal would
    // go through. `DispenseMedication` is `approval-required` — pharmacy's
    // own *top* tier (see `risk/pharmacy.ts`) — so this must be
    // `needs-human-approval`, never `accept` outright, regardless of how
    // deterministic the source rule was. Every prior CDSS planner's own
    // recommendation landed at the lower `review-required` tier; this is
    // the first proof of the identical claim at the highest-stakes one.
    const decision = pharmacyVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const telemetryLog = createInMemoryUiProposalTelemetryLog();
    const approvalPanel = deriveApprovalConfirmationPanel(proposal, decision);
    telemetryLog.record({
      component: approvalPanel.component,
      outcome: 'rendered',
      reasons: decision.reasons,
      recordedAt: '2026-08-01T01:04:59.000Z',
    });

    expect(approvalPanel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        prescriptionIds: ['rx-1'],
        instructionSummary: ['DispenseMedication — rx-1'],
        riskReasons: ["sequence contains an instruction at risk tier 'approval-required'"],
        modelVersion: 'cdss-pharmacy-dispense-rule-engine-v1',
        promptVersion: 'pharmacy-dispense-ruleset-v1',
      },
    });
    expect(telemetryLog.entries).toHaveLength(1);

    // A physician is permitted at pharmacy's lower review-required tier
    // but not this one — proving the recommendation really did land at
    // the top tier, not just that *some* approval works.
    const physicianIdentityProvider = createInMemoryIdentityProvider([
      { id: 'dr-lin', displayName: 'Dr. Lin', roles: ['physician'] },
    ]);
    const physicianResolution = resolveApprovalForProposal(physicianIdentityProvider, pharmacyRiskTiers, EXAMPLE_pharmacyApprovalPolicy, proposal, {
      approverId: 'dr-lin',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(physicianResolution.kind).toBe('unresolved');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'rph-tan', displayName: 'Tan (pharmacist)', roles: ['pharmacist'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, pharmacyRiskTiers, EXAMPLE_pharmacyApprovalPolicy, proposal, {
      approverId: 'rph-tan',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<PharmacyContext, PharmacyInstruction, PharmacyEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithPrescribedRx,
      reexecute: (ctx) => pharmacyEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.prescriptions['rx-1']).toMatchObject({ prescriptionId: 'rx-1', status: 'dispensed' });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      proposal: { modelVersion: 'cdss-pharmacy-dispense-rule-engine-v1', promptVersion: 'pharmacy-dispense-ruleset-v1' },
      approval: { approverId: 'rph-tan', approverRole: 'pharmacist' },
    });
  });

  it('an unresolved (impersonated) approval leaves a CDSS-recommended dispense awaiting approval, never committed', async () => {
    const signal: PharmacyDispenseReadySignal = { prescriptionId: prescriptionId('rx-1') };
    const planner = createCdssPharmacyPlanner();

    const planResult = await planWithRetries<CdssPharmacyContext, PharmacyInstruction>(
      planner,
      pharmacyInstructionValidators,
      { description: 'pharmacy queue sweep' },
      { pharmacyContext: contextWithPrescribedRx, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const doOutcome = pharmacyEngine.executeSequence(contextWithPrescribedRx, proposal.instructions);
    const decision = pharmacyVerifier.verify(proposal);

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'rph-tan', displayName: 'Tan (pharmacist)', roles: ['pharmacist'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, pharmacyRiskTiers, EXAMPLE_pharmacyApprovalPolicy, proposal, {
      approverId: 'someone-pretending-to-be-rph-tan',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<PharmacyContext, PharmacyInstruction, PharmacyEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithPrescribedRx,
      reexecute: (ctx) => pharmacyEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
