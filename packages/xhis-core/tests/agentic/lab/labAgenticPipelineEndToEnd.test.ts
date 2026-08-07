import { describe, expect, it } from 'vitest';
import { toPlanProposal } from '../../../src/agentic/planning/toPlanProposal.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { labInstructionValidators } from '../../../src/agentic/validation/lab.js';
import { labVerifier } from '../../../src/agentic/verification/lab.js';
import { labRiskTiers } from '../../../src/agentic/risk/lab.js';
import { EXAMPLE_labApprovalPolicy } from '../../../src/agentic/identity/lab.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { labEngine } from '../../../src/instructions/lab/engine.js';
import { encounterId, isoTimestamp, labOrderId } from '../../../src/instructions/lab/ids.js';
import type { LabContext, LabEffect, LabInstruction } from '../../../src/instructions/lab/types.js';

/**
 * Proves the full Plan -> Do -> Check -> Approve -> Act pipeline
 * genuinely works for lab, not just that the types compile — the first
 * domain besides `patient` exercised through the whole chain end to
 * end, closing the gap docs/DETERMINISTIC_CORE_PATTERN.md flagged:
 * agentic-layer integration existed only for `patient`, so none of the
 * other six domains could ever be an LLM/CDSS proposal target.
 */
describe('lab agentic pipeline, end to end', () => {
  const emptyLabContext: LabContext = { orders: {} };

  it('a raw untrusted OrderLabTest candidate flows through validation, Do, Check, approval, and Act to a real commit', () => {
    const proposalResult = toPlanProposal<LabInstruction>(
      labInstructionValidators,
      {
        instructions: [
          { kind: 'OrderLabTest', orderId: 'order-1', encounterId: 'encounter-1', testCode: 'CBC', orderedAt: '2026-07-22T00:00:00.000Z' },
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

    const doOutcome = labEngine.executeSequence(emptyLabContext, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = labVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'tech-chen', displayName: 'Chen (MT)', roles: ['lab-technologist'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, labRiskTiers, EXAMPLE_labApprovalPolicy, proposal, {
      approverId: 'tech-chen',
      approved: true,
      decidedAt: '2026-07-22T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<LabContext, LabInstruction, LabEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: emptyLabContext,
      reexecute: (ctx) => labEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-07-22T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.orders['order-1']).toMatchObject({ orderId: 'order-1', status: 'ordered' });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      approval: { approverId: 'tech-chen', approverRole: 'lab-technologist' },
    });
  });

  it('a malformed candidate never becomes a PlanProposal at all', () => {
    const proposalResult = toPlanProposal<LabInstruction>(
      labInstructionValidators,
      {
        instructions: [{ kind: 'OrderLabTest', orderId: '' }],
        rationale: 'malformed',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
      },
      '2026-07-22T00:00:00.000Z',
    );

    expect(proposalResult.ok).toBe(false);
  });

  it('a lab-technologist cannot approve ReportLabResult — only physician satisfies its (higher) tier', () => {
    const orderId = labOrderId('order-1');
    const reportResult: LabInstruction = {
      kind: 'ReportLabResult',
      orderId,
      result: 'WBC 7.2',
      resultedAt: isoTimestamp('2026-07-22T01:00:00.000Z'),
    };
    const proposal: PlanProposal<LabInstruction> = {
      instructions: [reportResult],
      rationale: 'result reported per analyzer',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-22T01:00:00.000Z',
    };

    const contextWithPendingOrder: LabContext = {
      orders: {
        'order-1': {
          orderId,
          encounterId: encounterId('encounter-1'),
          testCode: 'CBC',
          status: 'ordered',
          orderedAt: isoTimestamp('2026-07-22T00:00:00.000Z'),
        },
      },
    };

    const doOutcome = labEngine.executeSequence(contextWithPendingOrder, proposal.instructions);
    const decision = labVerifier.verify(proposal);
    expect(decision.kind).toBe('needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'tech-chen', displayName: 'Chen (MT)', roles: ['lab-technologist'] },
    ]);

    const resolution = resolveApprovalForProposal(identityProvider, labRiskTiers, EXAMPLE_labApprovalPolicy, proposal, {
      approverId: 'tech-chen',
      approved: true,
      decidedAt: '2026-07-22T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<LabContext, LabInstruction, LabEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithPendingOrder,
      reexecute: (ctx) => labEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-07-22T01:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
