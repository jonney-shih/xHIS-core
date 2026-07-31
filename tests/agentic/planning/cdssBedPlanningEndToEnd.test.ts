import { describe, expect, it } from 'vitest';
import { createCdssBedPlanner } from '../../../src/agentic/planning/cdssBedPlanner.js';
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
import { createInMemoryUiProposalTelemetryLog } from '../../../src/agentic/ui/telemetry.js';
import { EXAMPLE_firstAvailableBedStrategy } from '../../../src/integration/bedSelection.js';
import { bedEngine } from '../../../src/instructions/bed/engine.js';
import { bedId, encounterId } from '../../../src/instructions/bed/ids.js';
import type { BedContext, BedEffect, BedInstruction } from '../../../src/instructions/bed/types.js';

const contextWithAvailableBed: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };
const strategy = EXAMPLE_firstAvailableBedStrategy;

/**
 * The bed-domain counterpart to `cdssPlanningEndToEnd.test.ts` — same
 * `planWithRetries` -> `toPlanProposal` -> Do -> Check -> approval -> Act
 * pipeline, now driven by `createCdssBedPlanner` instead of
 * `createCdssTriagePlanner`, with zero pipeline code changed. Does not
 * repeat that file's `suggestVitalsEntryPanel`/`resolveUiRenderOutcome`
 * tests — there is no Agent-selected UI component for bed yet (no CDSS
 * existed to drive one until this file), and building one now, unasked,
 * would be guessing at a scenario rather than proving one, the same
 * restraint `ui/bed.ts`'s own doc comment already applies.
 */
describe('CDSS bed-assignment planning path, end to end', () => {
  it('retrying a deterministic rule against an unchanging input produces the identical failure every attempt, unlike an LLM recovering from feedback', async () => {
    // A signal with an empty encounterId — `validateAssignBed` rejects
    // this every time; nothing about `feedback` can make a rule that
    // ignores it (see `cdssBedPlanner.test.ts`) produce anything
    // different on a later attempt.
    const brokenSignal: BedNeedSignal = { encounterId: encounterId('') };
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
    const signal: BedNeedSignal = { encounterId: encounterId('encounter-1') };
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
    const signal: BedNeedSignal = { encounterId: encounterId('encounter-1') };
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
});
