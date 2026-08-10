import {
  act,
  createInMemoryIdentityProvider,
  createTelemetryHook,
  isoTimestamp,
  resolveApprovalForProposal,
  toPlanProposal,
} from '@xhis/core';
import type { TelemetryEvent } from '@xhis/core';
import { describe, expect, it } from 'vitest';
import { createOpsPlanner } from '../../src/agentic/planning/opsPlanner.js';
import { opsInstructionValidators } from '../../src/agentic/validation/ops.js';
import { opsVerifier } from '../../src/agentic/verification/ops.js';
import { createOpsShell } from '../../src/agentic/shell/opsShell.js';
import { opsEngine } from '../../src/instructions/engine.js';
import type { OpsContext, OpsInstruction } from '../../src/instructions/types.js';
import { EXAMPLE_opsApprovalPolicy } from '../../src/policy/approvalPolicy.js';
import { opsRiskTiers } from '../../src/policy/riskTiers.js';
import { createInMemorySandboxProvisioner } from '../../src/sandbox/inMemorySandboxProvisioner.js';
import { subscribeOpsTelemetryListener } from '../../src/telemetry/opsTelemetryListener.js';

const initialContext: OpsContext = { sandboxes: {} };

function planScaleDeployment(recommendedEvent: TelemetryEvent, proposedAt: string) {
  const planner = createOpsPlanner();
  return planner.plan(
    { description: 'self-heal from operational telemetry' },
    { events: [recommendedEvent] },
    proposedAt,
    [],
  );
}

/**
 * `ScalingRecommended` -> `ScaleDeployment`'s own end-to-end trace, the
 * fourth and last fully-implemented remediation *decision* path in
 * this package — every `OpsInstruction` variant now has one (see
 * `docs/XGUARD_INTEGRATION.md` and `agentic/planning/opsPlanner.ts`'s
 * own doc comment). `ScaleDeployment` sits at `'review-required'` (see
 * `policy/riskTiers.ts`), one tier below `CordonNode`'s
 * `'approval-required'` — this proves the review-tier approval path for
 * this package, the same claim `nodeUnhealthyRemediation.test.ts`
 * already proves for the top tier.
 */
describe('ScalingRecommended -> ScaleDeployment remediation, end to end', () => {
  it('emits a ScalingRecommended event, plans, needs review, and commits through OpsShell once a permitted identity approves', async () => {
    const hook = createTelemetryHook();
    const receivedEvents: TelemetryEvent[] = [];
    const unsubscribe = subscribeOpsTelemetryListener({
      hook,
      domain: 'ops',
      onEvent: (event) => receivedEvents.push(event),
    });

    const recommendedEvent: TelemetryEvent = {
      kind: 'ScalingRecommended',
      domain: 'ops',
      correlationId: 'deployment-checkout',
      recordedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
      targetReplicas: 8,
    };

    // 1. A fake ScalingRecommended event, emitted via @xhis/core's own hook.
    hook.emit(recommendedEvent);
    unsubscribe();
    expect(receivedEvents).toEqual([recommendedEvent]);

    // 2. The ops planner proposes ScaleDeployment for it, relaying the
    // already-decided replica count as-is.
    const proposedAt = '2026-08-01T00:00:01.000Z';
    const rawPlan = await planScaleDeployment(recommendedEvent, proposedAt);
    expect(rawPlan.ok).toBe(true);
    if (!rawPlan.ok) throw new Error('expected ok');
    expect(rawPlan.value.instructions).toEqual([
      { kind: 'ScaleDeployment', deploymentId: 'deployment-checkout', replicas: 8, requestedAt: proposedAt },
    ]);

    // The untrusted-plan-to-typed-instruction gate every domain's
    // planner output must pass through, deterministic rule or not.
    const proposalResult = toPlanProposal<OpsInstruction>(opsInstructionValidators, rawPlan.value, proposedAt);
    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) throw new Error('expected ok');
    const proposal = proposalResult.value;

    // 3. It needs human review at the 'review-required' tier.
    const decision = opsVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    // 4. A permitted identity (opsApprovalPolicy's 'review-required'
    // role) approves it.
    const identityProvider = createInMemoryIdentityProvider([
      { id: 'patel-sre-oncall', displayName: 'Patel (SRE on-call)', roles: ['sre-oncall'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, opsRiskTiers, EXAMPLE_opsApprovalPolicy, proposal, {
      approverId: 'patel-sre-oncall',
      approved: true,
      decidedAt: '2026-08-01T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    // 5. OpsShell.commit() is called. DeploymentScaled is recorded, but
    // (like NodeCordoned/ContainerRestarted) not forwarded to any real
    // action yet -- see opsShell.ts's own doc comment; this test proves
    // the decision-making half, not a real cluster scale call.
    const doOutcome = opsEngine.executeSequence(initialContext, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const provisioner = createInMemorySandboxProvisioner();
    const shell = createOpsShell(provisioner);

    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: initialContext,
      reexecute: (ctx) => opsEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T00:05:01.000Z',
      telemetryTag: { domain: 'ops', correlationId: 'deployment-checkout' },
    });

    expect(outcome).toBe('committed');
    expect(provisioner.reprovisionCalls).toEqual([]);

    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.effects).toEqual([
      { kind: 'DeploymentScaled', deploymentId: 'deployment-checkout', replicas: 8, requestedAt: proposedAt },
    ]);

    expect(shell.auditLog).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      proposal: { instructions: [{ kind: 'ScaleDeployment', deploymentId: 'deployment-checkout', replicas: 8 }] },
      approval: { approverId: 'patel-sre-oncall', approverRole: 'sre-oncall' },
    });
  });

  it('an unresolved (impersonated) approval leaves a ScaleDeployment recommendation awaiting approval, never committed', async () => {
    const recommendedEvent: TelemetryEvent = {
      kind: 'ScalingRecommended',
      domain: 'ops',
      correlationId: 'deployment-checkout',
      recordedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
      targetReplicas: 3,
    };
    const proposedAt = '2026-08-01T00:00:01.000Z';

    const rawPlan = await planScaleDeployment(recommendedEvent, proposedAt);
    if (!rawPlan.ok) throw new Error('expected ok');
    const proposalResult = toPlanProposal<OpsInstruction>(opsInstructionValidators, rawPlan.value, proposedAt);
    if (!proposalResult.ok) throw new Error('expected ok');
    const proposal = proposalResult.value;

    const doOutcome = opsEngine.executeSequence(initialContext, proposal.instructions);
    const decision = opsVerifier.verify(proposal);

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'patel-sre-oncall', displayName: 'Patel (SRE on-call)', roles: ['sre-oncall'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, opsRiskTiers, EXAMPLE_opsApprovalPolicy, proposal, {
      approverId: 'someone-pretending-to-be-patel',
      approved: true,
      decidedAt: '2026-08-01T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const provisioner = createInMemorySandboxProvisioner();
    const shell = createOpsShell(provisioner);
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: initialContext,
      reexecute: (ctx) => opsEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-08-01T00:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
