import { describe, expect, it } from 'vitest';
import { createCdssTriagePlanner } from '../../../src/agentic/planning/cdssPlanner.js';
import type { CdssTriageContext, TriageSignal } from '../../../src/agentic/planning/cdssPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { patientInstructionValidators } from '../../../src/agentic/validation/patient.js';
import { patientVerifier } from '../../../src/agentic/verification/patient.js';
import { patientRiskTiers } from '../../../src/agentic/risk/patient.js';
import { EXAMPLE_patientApprovalPolicy } from '../../../src/agentic/identity/patient.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/patient.js';
import { createInMemoryUiProposalTelemetryLog } from '../../../src/agentic/ui/telemetry.js';
import { patientEngine } from '../../../src/instructions/patient/engine.js';
import { encounterId, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../../src/instructions/patient/types.js';

const emptyPatientContext: PatientContext = { encounters: {} };

/**
 * Exercises the claim docs/DETERMINISTIC_CORE_PATTERN.md makes about
 * CDSS: "the same shape of problem... not a separate, less-rigorous
 * path." These tests run a CDSS-sourced proposal through the identical
 * `planWithRetries` -> `toPlanProposal` -> Do -> Check -> approval ->
 * Act pipeline `llmPlanningEndToEnd.test.ts` and
 * `approvalFlow.test.ts` already exercise for an LLM-sourced one, with
 * zero pipeline code changed.
 */
describe('CDSS planning path, end to end', () => {
  it('retrying a deterministic rule against an unchanging input produces the identical failure every attempt, unlike an LLM recovering from feedback', async () => {
    // A signal with an empty patientId — `validateAdmitPatient` rejects
    // this every time; nothing about `feedback` can make a rule that
    // ignores it (see `cdssPlanner.test.ts`) produce anything different
    // on a later attempt. `llmPlanningEndToEnd.test.ts`'s "recovers from
    // a hallucinated instruction kind on retry" test is the direct
    // counterexample: there, feedback text changes what the *next*
    // attempt produces, because an LLM reads it. Here, it can't.
    const brokenSignal: TriageSignal = { patientId: patientId(''), encounterId: encounterId('encounter-1'), severity: 'emergent' };
    const planner = createCdssTriagePlanner();

    // Explicit type arguments: like `createEngine` (see `patient/engine.ts`),
    // `planWithRetries` cannot infer `TInstruction` from
    // `patientInstructionValidators`, a mapped-type parameter
    // (`InstructionValidatorRegistry`) — inference through a mapped type's
    // generic key falls back to the `Kinded` constraint, not the concrete
    // `PatientInstruction` union.
    const result = await planWithRetries<CdssTriageContext, PatientInstruction>(
      planner,
      patientInstructionValidators,
      { description: 'triage sweep' },
      { patientContext: emptyPatientContext, signals: [brokenSignal] },
      '2026-07-20T00:00:00.000Z',
      3,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.attempts).toBe(3);
    expect(result.error.issues).toEqual(["instruction 0: 'patientId' must be a non-empty string"]);
  });

  it('a CDSS-recommended admission is not exempt from risk-tiered human approval, and commits only once a permitted identity approves', async () => {
    const signal: TriageSignal = { patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), severity: 'emergent' };
    const planner = createCdssTriagePlanner();

    const planResult = await planWithRetries<CdssTriageContext, PatientInstruction>(
      planner,
      patientInstructionValidators,
      { description: 'triage sweep' },
      { patientContext: emptyPatientContext, signals: [signal] },
      '2026-07-20T00:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    // Do — against the real, plain `PatientContext`, entirely decoupled
    // from `CdssTriageContext`: Do/Check/Act never know or care that this
    // proposal came from a rule engine rather than a model.
    const doOutcome = patientEngine.executeSequence(emptyPatientContext, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    // Check — the same `patientVerifier` an LLM-sourced proposal goes
    // through. `AdmitPatient` is `review-required` (see `risk/patient.ts`),
    // so this must be `needs-human-approval`, never `accept` outright,
    // regardless of how deterministic the source rule was.
    const decision = patientVerifier.verify(proposal);
    expect(decision.kind).toBe('needs-human-approval');
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    // This is the real wiring point for Guardrail #2's "fixed action
    // controls": Dr. Lin approves against this deterministically-derived
    // panel, not a bare data blob — and the panel is derived from Check's
    // own already-validated output, never from untrusted Agent/LLM text,
    // so there is nothing here for a hallucination to reach.
    const telemetryLog = createInMemoryUiProposalTelemetryLog();
    const approvalPanel = deriveApprovalConfirmationPanel(proposal, decision);
    telemetryLog.record({
      component: approvalPanel.component,
      outcome: 'rendered',
      reasons: decision.reasons,
      recordedAt: '2026-07-20T00:04:59.000Z',
    });

    expect(approvalPanel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        encounterIds: ['encounter-1'],
        instructionSummary: ['AdmitPatient — patient-1 / encounter-1'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'cdss-triage-rule-engine-v1',
        promptVersion: 'triage-ruleset-v1',
      },
    });
    expect(telemetryLog.entries).toHaveLength(1);

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'dr-lin', displayName: 'Dr. Lin', roles: ['physician'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, proposal, {
      approverId: 'dr-lin',
      approved: true,
      decidedAt: '2026-07-20T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<PatientContext, PatientInstruction, PatientEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: emptyPatientContext,
      reexecute: (ctx) => patientEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-07-20T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      proposal: { modelVersion: 'cdss-triage-rule-engine-v1', promptVersion: 'triage-ruleset-v1' },
      approval: { approverId: 'dr-lin', approverRole: 'physician' },
    });
  });

  it('an unresolved (impersonated) approval leaves a CDSS-recommended admission awaiting approval, never committed', async () => {
    const signal: TriageSignal = { patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), severity: 'emergent' };
    const planner = createCdssTriagePlanner();

    const planResult = await planWithRetries<CdssTriageContext, PatientInstruction>(
      planner,
      patientInstructionValidators,
      { description: 'triage sweep' },
      { patientContext: emptyPatientContext, signals: [signal] },
      '2026-07-20T00:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const doOutcome = patientEngine.executeSequence(emptyPatientContext, proposal.instructions);
    const decision = patientVerifier.verify(proposal);

    const identityProvider = createInMemoryIdentityProvider([{ id: 'dr-lin', displayName: 'Dr. Lin', roles: ['physician'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, proposal, {
      approverId: 'someone-pretending-to-be-dr-lin',
      approved: true,
      decidedAt: '2026-07-20T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<PatientContext, PatientInstruction, PatientEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: emptyPatientContext,
      reexecute: (ctx) => patientEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-07-20T00:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
