import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
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
import { isoTimestamp, studyId } from '../../../src/instructions/imaging/ids.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { ImagingContext, ImagingEffect, ImagingInstruction } from '../../../src/instructions/imaging/types.js';

const emptyImagingContext: ImagingContext = { studies: {} };

const orderStudy: ImagingInstruction = {
  kind: 'OrderStudy',
  studyId: studyId('study-1'),
  encounterId: encounterId('encounter-1'),
  modality: 'CT',
  orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
};

const performedContext: ImagingContext = {
  studies: {
    'study-1': {
      studyId: studyId('study-1'),
      encounterId: encounterId('encounter-1'),
      modality: 'CT',
      status: 'performed',
      orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
      performedAt: isoTimestamp('2026-08-01T00:30:00.000Z'),
      storageRef: 'pacs://study-1',
    },
  },
};

const reportStudy: ImagingInstruction = {
  kind: 'ReportStudy',
  studyId: studyId('study-1'),
  reportText: 'No acute findings.',
  reportedAt: isoTimestamp('2026-08-01T01:00:00.000Z'),
};

const orderProposal: PlanProposal<ImagingInstruction> = {
  instructions: [orderStudy],
  rationale: 'ordered per attending note',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-08-01T00:00:00.000Z',
};

const reportProposal: PlanProposal<ImagingInstruction> = {
  instructions: [reportStudy],
  rationale: 'report per radiologist read',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-08-01T01:00:00.000Z',
};

/**
 * The imaging-domain counterpart to `bedApprovalFlowEndToEnd.test.ts`'s,
 * `labApprovalFlowEndToEnd.test.ts`'s, `pharmacyApprovalFlowEndToEnd.test.ts`'s,
 * `schedulingApprovalFlowEndToEnd.test.ts`'s, and
 * `ledgerApprovalFlowEndToEnd.test.ts`'s real approval flows — same
 * wiring, hand-constructed proposals for the identical reason those
 * files document (no CDSS/LLM planner exists for imaging either).
 * `imagingAgenticPipelineEndToEnd.test.ts` already proved a referring
 * physician cannot approve `ReportStudy`; this file adds the half that
 * test couldn't show on its own — a `radiologist` actually *succeeding*
 * at exactly the tier a physician fails, plus the UI panel derivation
 * and telemetry recording every other domain's own approval-flow test
 * already exercises.
 */
describe('imaging domain approval flow, end to end', () => {
  it('a radiologic-technologist may approve an OrderStudy (review-required), and it commits', () => {
    const doOutcome = imagingEngine.executeSequence(emptyImagingContext, orderProposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = imagingVerifier.verify(orderProposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const telemetryLog = createInMemoryUiProposalTelemetryLog();
    const approvalPanel = deriveApprovalConfirmationPanel(orderProposal, decision);
    telemetryLog.record({ component: approvalPanel.component, outcome: 'rendered', reasons: decision.reasons, recordedAt: '2026-08-01T00:04:59.000Z' });
    expect(approvalPanel.props.studyIds).toEqual(['study-1']);

    const identityProvider = createInMemoryIdentityProvider([{ id: 'tech-huang', displayName: 'Huang (radiologic technologist)', roles: ['radiologic-technologist'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, imagingRiskTiers, EXAMPLE_imagingApprovalPolicy, orderProposal, {
      approverId: 'tech-huang',
      approved: true,
      decidedAt: '2026-08-01T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<ImagingContext, ImagingInstruction, ImagingEffect>();
    const outcome = act(shell, {
      proposal: orderProposal,
      doOutcome,
      decision,
      baselineContext: emptyImagingContext,
      reexecute: (ctx) => imagingEngine.executeSequence(ctx, orderProposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({ commitOutcome: 'committed', approval: { approverId: 'tech-huang', approverRole: 'radiologic-technologist' } });
  });

  it('a referring physician may NOT approve a ReportStudy (approval-required) — radiologist-only, and nothing commits', () => {
    const doOutcome = imagingEngine.executeSequence(performedContext, reportProposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = imagingVerifier.verify(reportProposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([{ id: 'dr-wu', displayName: 'Wu (referring physician)', roles: ['physician'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, imagingRiskTiers, EXAMPLE_imagingApprovalPolicy, reportProposal, {
      approverId: 'dr-wu',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    // Not impersonation this time -- a real, resolvable identity, just
    // one that doesn't hold a sufficient role for *this* tier.
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<ImagingContext, ImagingInstruction, ImagingEffect>();
    const outcome = act(shell, {
      proposal: reportProposal,
      doOutcome,
      decision,
      baselineContext: performedContext,
      reexecute: (ctx) => imagingEngine.executeSequence(ctx, reportProposal.instructions),
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });

  it('a radiologist may approve the same ReportStudy a referring physician could not, and it commits', () => {
    const doOutcome = imagingEngine.executeSequence(performedContext, reportProposal.instructions);
    const decision = imagingVerifier.verify(reportProposal);
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([{ id: 'dr-chiu', displayName: 'Chiu (radiologist)', roles: ['radiologist'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, imagingRiskTiers, EXAMPLE_imagingApprovalPolicy, reportProposal, {
      approverId: 'dr-chiu',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<ImagingContext, ImagingInstruction, ImagingEffect>();
    const outcome = act(shell, {
      proposal: reportProposal,
      doOutcome,
      decision,
      baselineContext: performedContext,
      reexecute: (ctx) => imagingEngine.executeSequence(ctx, reportProposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
  });
});
