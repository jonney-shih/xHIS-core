import { describe, expect, it } from 'vitest';
import { createCdssBedPlanner, suggestVitalsEntryPanel } from '../../../src/agentic/planning/cdssBedPlanner.js';
import type { BedNeedSignal, CdssBedContext } from '../../../src/agentic/planning/cdssBedPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { bedInstructionValidators } from '../../../src/agentic/validation/bed.js';
import { bedVerifier } from '../../../src/agentic/verification/bed.js';
import { bedRiskTiers } from '../../../src/agentic/risk/bed.js';
import { EXAMPLE_bedApprovalPolicy } from '../../../src/agentic/identity/bed.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/bed.js';
import { patientVitalsComponentPropsValidators } from '../../../src/agentic/ui/patient.js';
import { createInMemoryUiProposalTelemetryLog } from '../../../src/agentic/ui/telemetry.js';
import { resolveUiRenderOutcome } from '../../../src/agentic/ui/resolveUiRenderOutcome.js';
import { EXAMPLE_firstAvailableBedStrategy } from '../../../src/integration/bedSelection.js';
import { bedEngine } from '../../../src/instructions/bed/engine.js';
import { bedId, encounterId } from '../../../src/instructions/bed/ids.js';
import { patientId } from '../../../src/instructions/patient/ids.js';
import type { BedContext, BedEffect, BedInstruction } from '../../../src/instructions/bed/types.js';

const contextWithAvailableBed: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };
const strategy = EXAMPLE_firstAvailableBedStrategy;

/**
 * The bed-domain counterpart to `cdssPlanningEndToEnd.test.ts` — same
 * `planWithRetries` -> `toPlanProposal` -> Do -> Check -> approval -> Act
 * pipeline, now driven by `createCdssBedPlanner` instead of
 * `createCdssTriagePlanner`, with zero pipeline code changed. Also
 * proves the Agent-selected UI half of the contract for bed — see the
 * vitals-entry-panel tests below, added once `createCdssBedPlanner`
 * gave bed a real CDSS to drive one from, reusing patient's own
 * `VitalsEntryPanel` rather than inventing a bed-specific lookalike
 * (see `cdssBedPlanner.ts`'s own `suggestVitalsEntryPanel` doc comment
 * for why).
 */
describe('CDSS bed-assignment planning path, end to end', () => {
  it('retrying a deterministic rule against an unchanging input produces the identical failure every attempt, unlike an LLM recovering from feedback', async () => {
    // A signal with an empty encounterId — `validateAssignBed` rejects
    // this every time; nothing about `feedback` can make a rule that
    // ignores it (see `cdssBedPlanner.test.ts`) produce anything
    // different on a later attempt.
    const brokenSignal: BedNeedSignal = { encounterId: encounterId(''), patientId: patientId('patient-1') };
    const planner = createCdssBedPlanner();

    // Explicit type arguments: like `createEngine` (see `bed/engine.ts`),
    // `planWithRetries` cannot infer `TInstruction` from
    // `bedInstructionValidators`, a mapped-type parameter
    // (`InstructionValidatorRegistry`) — inference through a mapped
    // type's generic key falls back to the `Kinded` constraint, not the
    // concrete `BedInstruction` union.
    const result = await planWithRetries<CdssBedContext, BedInstruction>(
      planner,
      bedInstructionValidators,
      { description: 'bed board sweep' },
      { bedContext: contextWithAvailableBed, signals: [brokenSignal], strategy },
      '2026-08-01T00:00:00.000Z',
      3,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.attempts).toBe(3);
    expect(result.error.issues).toEqual(["instruction 0: 'encounterId' must be a non-empty string"]);
  });

  it('a CDSS-recommended bed assignment is not exempt from risk-tiered human approval, and commits only once a permitted identity approves', async () => {
    const signal: BedNeedSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };
    const planner = createCdssBedPlanner();

    const planResult = await planWithRetries<CdssBedContext, BedInstruction>(
      planner,
      bedInstructionValidators,
      { description: 'bed board sweep' },
      { bedContext: contextWithAvailableBed, signals: [signal], strategy },
      '2026-08-01T00:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    // Do — against the real, plain `BedContext`, entirely decoupled from
    // `CdssBedContext`: Do/Check/Act never know or care that this
    // proposal came from a rule engine rather than a model.
    const doOutcome = bedEngine.executeSequence(contextWithAvailableBed, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    // Check — the same `bedVerifier` an LLM-sourced proposal would go
    // through. `AssignBed` is `review-required` (see `risk/bed.ts`), so
    // this must be `needs-human-approval`, never `accept` outright,
    // regardless of how deterministic the source rule was.
    const decision = bedVerifier.verify(proposal);
    expect(decision.kind).toBe('needs-human-approval');
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const telemetryLog = createInMemoryUiProposalTelemetryLog();
    const approvalPanel = deriveApprovalConfirmationPanel(proposal, decision);
    telemetryLog.record({
      component: approvalPanel.component,
      outcome: 'rendered',
      reasons: decision.reasons,
      recordedAt: '2026-08-01T00:04:59.000Z',
    });

    expect(approvalPanel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        bedIds: ['bed-1'],
        instructionSummary: ['AssignBed — bed-1 / encounter-1'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'cdss-bed-assignment-rule-engine-v1',
        promptVersion: 'bed-assignment-ruleset-v1',
      },
    });
    expect(telemetryLog.entries).toHaveLength(1);

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'coord-lin', displayName: 'Lin (bed coordinator)', roles: ['bed-coordinator'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, bedRiskTiers, EXAMPLE_bedApprovalPolicy, proposal, {
      approverId: 'coord-lin',
      approved: true,
      decidedAt: '2026-08-01T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<BedContext, BedInstruction, BedEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithAvailableBed,
      reexecute: (ctx) => bedEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.beds['bed-1']).toMatchObject({ bedId: 'bed-1', status: 'occupied', encounterId: 'encounter-1' });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      proposal: { modelVersion: 'cdss-bed-assignment-rule-engine-v1', promptVersion: 'bed-assignment-ruleset-v1' },
      approval: { approverId: 'coord-lin', approverRole: 'bed-coordinator' },
    });
  });

  it('an unresolved (impersonated) approval leaves a CDSS-recommended bed assignment awaiting approval, never committed', async () => {
    const signal: BedNeedSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };
    const planner = createCdssBedPlanner();

    const planResult = await planWithRetries<CdssBedContext, BedInstruction>(
      planner,
      bedInstructionValidators,
      { description: 'bed board sweep' },
      { bedContext: contextWithAvailableBed, signals: [signal], strategy },
      '2026-08-01T00:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const doOutcome = bedEngine.executeSequence(contextWithAvailableBed, proposal.instructions);
    const decision = bedVerifier.verify(proposal);

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'coord-lin', displayName: 'Lin (bed coordinator)', roles: ['bed-coordinator'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, bedRiskTiers, EXAMPLE_bedApprovalPolicy, proposal, {
      approverId: 'someone-pretending-to-be-coord-lin',
      approved: true,
      decidedAt: '2026-08-01T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<BedContext, BedInstruction, BedEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithAvailableBed,
      reexecute: (ctx) => bedEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-08-01T00:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });

  /**
   * `ui/resolveUiRenderOutcome.test.ts` proves this mechanism against
   * the illustrative fixture only; `cdssPlanningEndToEnd.test.ts` proves
   * it against a real production consumer for patient's own triage rule.
   * This proves it against a *second* real consumer of the identical
   * `VitalsEntryPanel` component: bed's own CDSS rule, genuinely
   * Agent-selected, so it has to pass through the same validation gate
   * an LLM's raw JSON would, even though the source here is a
   * deterministic rule and the triggering signal is a bed assignment,
   * not an admission.
   */
  it("bed's own vitals-entry-panel suggestion, for the same signal that recommended a bed assignment, renders through the real validation gate", () => {
    const signal: BedNeedSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };
    const telemetryLog = createInMemoryUiProposalTelemetryLog();

    const outcome = resolveUiRenderOutcome({
      registry: patientVitalsComponentPropsValidators,
      raw: suggestVitalsEntryPanel(signal),
      proposedAt: '2026-08-01T00:00:00.000Z',
      telemetryLog,
      recordedAt: '2026-08-01T00:00:01.000Z',
    });

    expect(outcome).toEqual({
      kind: 'render',
      component: { component: 'VitalsEntryPanel', props: { encounterId: 'encounter-1', patientId: 'patient-1' } },
    });
    expect(telemetryLog.entries).toEqual([
      { component: 'VitalsEntryPanel', outcome: 'rendered', reasons: [], recordedAt: '2026-08-01T00:00:01.000Z' },
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
        rationale: 'CDSS bed-assignment rule: suggesting vitals entry for a newly recommended bed assignment',
        modelVersion: 'cdss-bed-assignment-rule-engine-v1',
        promptVersion: 'bed-assignment-ruleset-v1',
      },
      proposedAt: '2026-08-01T00:00:00.000Z',
      telemetryLog,
      recordedAt: '2026-08-01T00:00:01.000Z',
    });

    expect(outcome).toEqual({ kind: 'fallback', reasons: ["'props.patientId' must be a non-empty string"] });
    expect(telemetryLog.entries).toEqual([
      {
        component: 'VitalsEntryPanel',
        outcome: 'fallback',
        reasons: ["'props.patientId' must be a non-empty string"],
        recordedAt: '2026-08-01T00:00:01.000Z',
      },
    ]);
  });
});
