import { describe, expect, it } from 'vitest';
import { toPlanProposal } from '../../../src/agentic/planning/toPlanProposal.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { imagingInstructionValidators } from '../../../src/agentic/validation/imaging.js';
import { imagingVerifier } from '../../../src/agentic/verification/imaging.js';
import { imagingRiskTiers } from '../../../src/agentic/risk/imaging.js';
import { EXAMPLE_imagingApprovalPolicy } from '../../../src/agentic/identity/imaging.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { imagingEngine } from '../../../src/instructions/imaging/engine.js';
import { isoTimestamp, studyId } from '../../../src/instructions/imaging/ids.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { ImagingContext, ImagingEffect, ImagingInstruction } from '../../../src/instructions/imaging/types.js';

/**
 * Proves the full Plan -> Do -> Check -> Approve -> Act pipeline
 * genuinely works for imaging, not just that the types compile — the
 * fifth domain besides `patient` (after `lab`, `bed`, `ledger`,
 * `scheduling`) exercised through the whole chain end to end.
 */
describe('imaging agentic pipeline, end to end', () => {
  const emptyImagingContext: ImagingContext = { studies: {} };

  it('a raw untrusted OrderStudy candidate flows through validation, Do, Check, approval, and Act to a real commit', () => {
    const proposalResult = toPlanProposal<ImagingInstruction>(
      imagingInstructionValidators,
      {
        instructions: [
          { kind: 'OrderStudy', studyId: 'study-1', encounterId: 'encounter-1', modality: 'CT', orderedAt: '2026-07-22T00:00:00.000Z' },
        ],
        rationale: 'ordered per attending note',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
      '2026-07-22T00:00:00.000Z',
    );
    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) throw new Error('expected ok');
    const proposal = proposalResult.value;

    const doOutcome = imagingEngine.executeSequence(emptyImagingContext, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = imagingVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'tech-huang', displayName: 'Huang (radiologic technologist)', roles: ['radiologic-technologist'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, imagingRiskTiers, EXAMPLE_imagingApprovalPolicy, proposal, {
      approverId: 'tech-huang',
      approved: true,
      decidedAt: '2026-07-22T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<ImagingContext, ImagingInstruction, ImagingEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: emptyImagingContext,
      reexecute: (ctx) => imagingEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-07-22T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.studies['study-1']).toMatchObject({ studyId: 'study-1', status: 'ordered' });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      approval: { approverId: 'tech-huang', approverRole: 'radiologic-technologist' },
    });
  });

  it('a malformed candidate never becomes a PlanProposal at all', () => {
    const proposalResult = toPlanProposal<ImagingInstruction>(
      imagingInstructionValidators,
      {
        instructions: [{ kind: 'OrderStudy', studyId: '' }],
        rationale: 'malformed',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
      '2026-07-22T00:00:00.000Z',
    );

    expect(proposalResult.ok).toBe(false);
  });

  it('a referring physician cannot approve ReportStudy — only a radiologist satisfies its (higher) tier', () => {
    const orderedStudyId = studyId('study-1');
    const reportStudy: ImagingInstruction = {
      kind: 'ReportStudy',
      studyId: orderedStudyId,
      reportText: 'No acute findings.',
      reportedAt: isoTimestamp('2026-07-22T01:00:00.000Z'),
    };
    const proposal: PlanProposal<ImagingInstruction> = {
      instructions: [reportStudy],
      rationale: 'report per radiologist read',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-22T01:00:00.000Z',
    };

    const contextWithPerformedStudy: ImagingContext = {
      studies: {
        'study-1': {
          studyId: orderedStudyId,
          encounterId: encounterId('encounter-1'),
          modality: 'CT',
          status: 'performed',
          orderedAt: isoTimestamp('2026-07-22T00:00:00.000Z'),
          performedAt: isoTimestamp('2026-07-22T00:30:00.000Z'),
          storageRef: 'pacs://study-1',
        },
      },
    };

    const doOutcome = imagingEngine.executeSequence(contextWithPerformedStudy, proposal.instructions);
    const decision = imagingVerifier.verify(proposal);
    expect(decision.kind).toBe('needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'dr-wu', displayName: 'Wu (referring physician)', roles: ['physician'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, imagingRiskTiers, EXAMPLE_imagingApprovalPolicy, proposal, {
      approverId: 'dr-wu',
      approved: true,
      decidedAt: '2026-07-22T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<ImagingContext, ImagingInstruction, ImagingEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithPerformedStudy,
      reexecute: (ctx) => imagingEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-07-22T01:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
