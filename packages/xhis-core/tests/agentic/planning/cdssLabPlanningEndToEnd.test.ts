import { describe, expect, it } from 'vitest';
import { createCdssLabPlanner, suggestVitalsEntryPanel } from '../../../src/agentic/planning/cdssLabPlanner.js';
import type { CdssLabContext, LabDischargeSignal } from '../../../src/agentic/planning/cdssLabPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { labInstructionValidators } from '../../../src/agentic/validation/lab.js';
import { labVerifier } from '../../../src/agentic/verification/lab.js';
import { labRiskTiers } from '../../../src/agentic/risk/lab.js';
import { EXAMPLE_labApprovalPolicy } from '../../../src/agentic/identity/lab.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/lab.js';
import { patientVitalsComponentPropsValidators } from '../../../src/agentic/ui/patient.js';
import { createInMemoryUiProposalTelemetryLog } from '../../../src/agentic/ui/telemetry.js';
import { resolveUiRenderOutcome } from '../../../src/agentic/ui/resolveUiRenderOutcome.js';
import { labEngine } from '../../../src/instructions/lab/engine.js';
import { encounterId, isoTimestamp, labOrderId } from '../../../src/instructions/lab/ids.js';
import { patientId } from '../../../src/instructions/patient/ids.js';
import type { LabContext, LabEffect, LabInstruction } from '../../../src/instructions/lab/types.js';

const contextWithPendingOrder: LabContext = {
  orders: {
    'order-1': { orderId: labOrderId('order-1'), encounterId: encounterId('encounter-1'), testCode: 'CBC', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
  },
};

/**
 * The lab-domain counterpart to `cdssBedPlanningEndToEnd.test.ts` — same
 * `planWithRetries` -> `toPlanProposal` -> Do -> Check -> approval -> Act
 * pipeline, now driven by `createCdssLabPlanner`. Also proves the
 * Agent-selected UI half of the contract for lab — see the
 * vitals-entry-panel tests below, reusing patient's own
 * `VitalsEntryPanel` for a genuinely different real-world reason than
 * patient's or bed's (see `cdssLabPlanner.ts`'s own
 * `suggestVitalsEntryPanel` doc comment: discharge vitals, not an
 * arrival checkpoint).
 */
describe('CDSS lab-cancellation planning path, end to end', () => {
  it('retrying a deterministic rule against an unchanging bad timestamp produces the identical failure every attempt, unlike an LLM recovering from feedback', async () => {
    // Unlike bed's own retry-determinism test, a malformed *signal* can't
    // taint the output here: `CancelLabOrder` never carries `encounterId`
    // at all (see `cdssLabPlanner.ts`'s own doc comment), so the signal's
    // `encounterId` is only ever used for the lookup, never copied into
    // the instruction. The one input this rule's output *does* carry
    // straight through unvalidated is `proposedAt` — a malformed one
    // taints `cancelledAt` on every attempt identically, since
    // `planWithRetries` passes the same `proposedAt` to every attempt.
    const signal: LabDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };
    const planner = createCdssLabPlanner();

    // Explicit type arguments: same mapped-type inference limitation
    // `createEngine` call sites already document (see `lab/engine.ts`).
    const result = await planWithRetries<CdssLabContext, LabInstruction>(
      planner,
      labInstructionValidators,
      { description: 'discharge sweep' },
      { labContext: contextWithPendingOrder, signals: [signal] },
      'not-a-timestamp',
      3,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.attempts).toBe(3);
    expect(result.error.issues).toEqual(["instruction 0: 'cancelledAt' must be an ISO-8601 timestamp string"]);
  });

  it('a CDSS-recommended cancellation is not exempt from risk-tiered human approval, and commits only once a permitted identity approves', async () => {
    const signal: LabDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };
    const planner = createCdssLabPlanner();

    const planResult = await planWithRetries<CdssLabContext, LabInstruction>(
      planner,
      labInstructionValidators,
      { description: 'discharge sweep' },
      { labContext: contextWithPendingOrder, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    // Do — against the real, plain `LabContext`, entirely decoupled from
    // `CdssLabContext`: Do/Check/Act never know or care that this
    // proposal came from a rule engine rather than a model.
    const doOutcome = labEngine.executeSequence(contextWithPendingOrder, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    // Check — the same `labVerifier` an LLM-sourced proposal would go
    // through. `CancelLabOrder` is `review-required` (see `risk/lab.ts`),
    // so this must be `needs-human-approval`, never `accept` outright,
    // regardless of how deterministic the source rule was.
    const decision = labVerifier.verify(proposal);
    expect(decision.kind).toBe('needs-human-approval');
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
        orderIds: ['order-1'],
        instructionSummary: ['CancelLabOrder — order-1'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'cdss-lab-cancellation-rule-engine-v1',
        promptVersion: 'lab-cancellation-ruleset-v1',
      },
    });
    expect(telemetryLog.entries).toHaveLength(1);

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'tech-lin', displayName: 'Tech Lin', roles: ['lab-technologist'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, labRiskTiers, EXAMPLE_labApprovalPolicy, proposal, {
      approverId: 'tech-lin',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<LabContext, LabInstruction, LabEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithPendingOrder,
      reexecute: (ctx) => labEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.orders['order-1']).toMatchObject({ orderId: 'order-1', status: 'cancelled' });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      proposal: { modelVersion: 'cdss-lab-cancellation-rule-engine-v1', promptVersion: 'lab-cancellation-ruleset-v1' },
      approval: { approverId: 'tech-lin', approverRole: 'lab-technologist' },
    });
  });

  it('an unresolved (impersonated) approval leaves a CDSS-recommended cancellation awaiting approval, never committed', async () => {
    const signal: LabDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };
    const planner = createCdssLabPlanner();

    const planResult = await planWithRetries<CdssLabContext, LabInstruction>(
      planner,
      labInstructionValidators,
      { description: 'discharge sweep' },
      { labContext: contextWithPendingOrder, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const doOutcome = labEngine.executeSequence(contextWithPendingOrder, proposal.instructions);
    const decision = labVerifier.verify(proposal);

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'tech-lin', displayName: 'Tech Lin', roles: ['lab-technologist'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, labRiskTiers, EXAMPLE_labApprovalPolicy, proposal, {
      approverId: 'someone-pretending-to-be-tech-lin',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<LabContext, LabInstruction, LabEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithPendingOrder,
      reexecute: (ctx) => labEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });

  /**
   * `ui/resolveUiRenderOutcome.test.ts` proves this mechanism against
   * the illustrative fixture only; `cdssPlanningEndToEnd.test.ts` and
   * `cdssBedPlanningEndToEnd.test.ts` each prove it against a real
   * production consumer. This is the third real consumer of the
   * identical `VitalsEntryPanel` component: lab's own CDSS rule,
   * genuinely Agent-selected, so it has to pass through the same
   * validation gate an LLM's raw JSON would, even though the source
   * here is a deterministic rule and the triggering signal is a
   * discharge, not an admission or a bed assignment.
   */
  it("lab's own vitals-entry-panel suggestion, for the same signal that recommended a cancellation, renders through the real validation gate", () => {
    const signal: LabDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };
    const telemetryLog = createInMemoryUiProposalTelemetryLog();

    const outcome = resolveUiRenderOutcome({
      registry: patientVitalsComponentPropsValidators,
      raw: suggestVitalsEntryPanel(signal),
      proposedAt: '2026-08-01T01:00:00.000Z',
      telemetryLog,
      recordedAt: '2026-08-01T01:00:01.000Z',
    });

    expect(outcome).toEqual({
      kind: 'render',
      component: { component: 'VitalsEntryPanel', props: { encounterId: 'encounter-1', patientId: 'patient-1' } },
    });
    expect(telemetryLog.entries).toEqual([
      { component: 'VitalsEntryPanel', outcome: 'rendered', reasons: [], recordedAt: '2026-08-01T01:00:01.000Z' },
    ]);
  });

  it('a vitals-entry-panel candidate missing a required field falls back instead of rendering, even though the source rule is deterministic', () => {
    const telemetryLog = createInMemoryUiProposalTelemetryLog();

    // The same shape suggestVitalsEntryPanel produces, but with
    // patientId corrupted away -- standing in for whatever real-world
    // failure mode (a bad upstream signal, a future rule-engine bug)
    // could produce an incomplete candidate; being deterministic never
    // exempts it from the same fallback path an LLM's malformed JSON
    // would take.
    const outcome = resolveUiRenderOutcome({
      registry: patientVitalsComponentPropsValidators,
      raw: {
        component: { component: 'VitalsEntryPanel', props: { encounterId: 'encounter-1' } },
        rationale: 'CDSS lab rule: suggesting discharge vitals entry for a newly recommended lab-order cancellation',
        modelVersion: 'cdss-lab-cancellation-rule-engine-v1',
        promptVersion: 'lab-cancellation-ruleset-v1',
      },
      proposedAt: '2026-08-01T01:00:00.000Z',
      telemetryLog,
      recordedAt: '2026-08-01T01:00:01.000Z',
    });

    expect(outcome).toEqual({ kind: 'fallback', reasons: ["'props.patientId' must be a non-empty string"] });
    expect(telemetryLog.entries).toEqual([
      {
        component: 'VitalsEntryPanel',
        outcome: 'fallback',
        reasons: ["'props.patientId' must be a non-empty string"],
        recordedAt: '2026-08-01T01:00:01.000Z',
      },
    ]);
  });
});
