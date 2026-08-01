import { describe, expect, it } from 'vitest';
import { createCdssImagingPlanner } from '../../../src/agentic/planning/cdssImagingPlanner.js';
import type { CdssImagingContext, ImagingDischargeSignal } from '../../../src/agentic/planning/cdssImagingPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { imagingInstructionValidators } from '../../../src/agentic/validation/imaging.js';
import { imagingVerifier } from '../../../src/agentic/verification/imaging.js';
import { imagingRiskTiers } from '../../../src/agentic/risk/imaging.js';
import { EXAMPLE_imagingApprovalPolicy } from '../../../src/agentic/identity/imaging.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/imaging.js';
import { createInMemoryUiProposalTelemetryLog } from '../../../src/agentic/ui/telemetry.js';
import { imagingEngine } from '../../../src/instructions/imaging/engine.js';
import { encounterId, isoTimestamp, studyId } from '../../../src/instructions/imaging/ids.js';
import type { ImagingContext, ImagingEffect, ImagingInstruction } from '../../../src/instructions/imaging/types.js';

const contextWithOrderedStudy: ImagingContext = {
  studies: {
    'study-1': { studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
  },
};

/**
 * The imaging-domain counterpart to `cdssLabPlanningEndToEnd.test.ts` —
 * same `planWithRetries` -> `toPlanProposal` -> Do -> Check -> approval
 * -> Act pipeline, now driven by `createCdssImagingPlanner`. Unlike
 * lab's/pharmacy's/scheduling's/ledger's own end-to-end files, this one
 * has no "role X fails, role Y succeeds" contrast to prove:
 * `CancelStudy` sits at `review-required`, where either `physician` or
 * `radiologic-technologist` already suffices (see `risk/imaging.ts`'s
 * own doc comment), so the interesting proof here is only that a CDSS
 * recommendation still needs *some* permitted approval, never an
 * outright `accept` — the same claim lab's own `OrderLabTest` test
 * proves at its identical tier. Does not repeat the
 * `suggestVitalsEntryPanel`/`resolveUiRenderOutcome` tests for the same
 * reason every prior non-patient CDSS end-to-end file doesn't: no
 * Agent-selected UI component exists for imaging.
 */
describe('CDSS imaging-cancellation planning path, end to end', () => {
  it('retrying a deterministic rule against an unchanging bad timestamp produces the identical failure every attempt, unlike an LLM recovering from feedback', async () => {
    // Same reasoning `cdssLabPlanningEndToEnd.test.ts`'s own retry test
    // gives: `CancelStudy` never carries `encounterId` at all, so a
    // malformed *signal* can't taint the output; `proposedAt` is the one
    // input that flows straight into `cancelledAt` unvalidated, and
    // `planWithRetries` passes the same one to every attempt.
    const signal: ImagingDischargeSignal = { encounterId: encounterId('encounter-1') };
    const planner = createCdssImagingPlanner();

    // Explicit type arguments: same mapped-type inference limitation
    // `createEngine` call sites already document (see
    // `imaging/engine.ts`).
    const result = await planWithRetries<CdssImagingContext, ImagingInstruction>(
      planner,
      imagingInstructionValidators,
      { description: 'discharge sweep' },
      { imagingContext: contextWithOrderedStudy, signals: [signal] },
      'not-a-timestamp',
      3,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.attempts).toBe(3);
    expect(result.error.issues).toEqual(["instruction 0: 'cancelledAt' must be an ISO-8601 timestamp string"]);
  });

  it('a CDSS-recommended cancellation is not exempt from risk-tiered human approval, and commits once a permitted identity approves', async () => {
    const signal: ImagingDischargeSignal = { encounterId: encounterId('encounter-1') };
    const planner = createCdssImagingPlanner();

    const planResult = await planWithRetries<CdssImagingContext, ImagingInstruction>(
      planner,
      imagingInstructionValidators,
      { description: 'discharge sweep' },
      { imagingContext: contextWithOrderedStudy, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    // Do — against the real, plain `ImagingContext`, entirely decoupled
    // from `CdssImagingContext`: Do/Check/Act never know or care that
    // this proposal came from a rule engine rather than a model.
    const doOutcome = imagingEngine.executeSequence(contextWithOrderedStudy, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    // Check — the same `imagingVerifier` an LLM-sourced proposal would
    // go through. `CancelStudy` is `review-required` (see
    // `risk/imaging.ts`), so this must be `needs-human-approval`, never
    // `accept` outright, regardless of how deterministic the source
    // rule was.
    const decision = imagingVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
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
        studyIds: ['study-1'],
        instructionSummary: ['CancelStudy — study-1'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'cdss-imaging-cancellation-rule-engine-v1',
        promptVersion: 'imaging-cancellation-ruleset-v1',
      },
    });
    expect(telemetryLog.entries).toHaveLength(1);

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'tech-huang', displayName: 'Huang (radiologic technologist)', roles: ['radiologic-technologist'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, imagingRiskTiers, EXAMPLE_imagingApprovalPolicy, proposal, {
      approverId: 'tech-huang',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<ImagingContext, ImagingInstruction, ImagingEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithOrderedStudy,
      reexecute: (ctx) => imagingEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.studies['study-1']).toMatchObject({ studyId: 'study-1', status: 'cancelled' });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      proposal: { modelVersion: 'cdss-imaging-cancellation-rule-engine-v1', promptVersion: 'imaging-cancellation-ruleset-v1' },
      approval: { approverId: 'tech-huang', approverRole: 'radiologic-technologist' },
    });
  });

  it('an unresolved (impersonated) approval leaves a CDSS-recommended cancellation awaiting approval, never committed', async () => {
    const signal: ImagingDischargeSignal = { encounterId: encounterId('encounter-1') };
    const planner = createCdssImagingPlanner();

    const planResult = await planWithRetries<CdssImagingContext, ImagingInstruction>(
      planner,
      imagingInstructionValidators,
      { description: 'discharge sweep' },
      { imagingContext: contextWithOrderedStudy, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const doOutcome = imagingEngine.executeSequence(contextWithOrderedStudy, proposal.instructions);
    const decision = imagingVerifier.verify(proposal);

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'tech-huang', displayName: 'Huang (radiologic technologist)', roles: ['radiologic-technologist'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, imagingRiskTiers, EXAMPLE_imagingApprovalPolicy, proposal, {
      approverId: 'someone-pretending-to-be-tech-huang',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<ImagingContext, ImagingInstruction, ImagingEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithOrderedStudy,
      reexecute: (ctx) => imagingEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
