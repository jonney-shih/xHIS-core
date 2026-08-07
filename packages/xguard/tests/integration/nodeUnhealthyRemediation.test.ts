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

function planCordonNode(unhealthyEvent: TelemetryEvent, proposedAt: string) {
  const planner = createOpsPlanner();
  return planner.plan(
    { description: 'self-heal from operational telemetry' },
    { events: [unhealthyEvent] },
    proposedAt,
    [],
  );
}

/**
 * `NodeUnhealthy` -> `CordonNode`'s own end-to-end trace, the second
 * fully-implemented remediation path in this package (see
 * `docs/XGUARD_INTEGRATION.md` and `agentic/planning/opsPlanner.ts`'s
 * own doc comment). Unlike `sandboxTimeoutRemediation.test.ts`'s
 * `'auto'`-tier path, `CordonNode` sits at `'approval-required'` (see
 * `policy/riskTiers.ts`) — this is this package's first proof that the
 * approval gate itself (identity + role resolution, not just risk-tier
 * classification) works correctly for an ops-domain proposal, the same
 * claim every clinical domain's own first `'approval-required'` test
 * already proves for itself.
 */
describe('NodeUnhealthy -> CordonNode remediation, end to end', () => {
  it('emits a NodeUnhealthy event, plans, needs approval, and commits through OpsShell once a permitted identity approves', async () => {
    const hook = createTelemetryHook();
    const receivedEvents: TelemetryEvent[] = [];
    const unsubscribe = subscribeOpsTelemetryListener({
      hook,
      domain: 'ops',
      onEvent: (event) => receivedEvents.push(event),
    });

    const unhealthyEvent: TelemetryEvent = {
      kind: 'NodeUnhealthy',
      domain: 'ops',
      correlationId: 'node-7',
      recordedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
      pressure: 'MemoryPressure',
      sustainedForMs: 120_000,
    };

    // 1. A fake NodeUnhealthy event, emitted via @xhis/core's own hook.
    hook.emit(unhealthyEvent);
    unsubscribe();
    expect(receivedEvents).toEqual([unhealthyEvent]);

    // 2. The ops planner proposes CordonNode for it.
    const proposedAt = '2026-08-01T00:00:01.000Z';
    const rawPlan = await planCordonNode(unhealthyEvent, proposedAt);
    expect(rawPlan.ok).toBe(true);
    if (!rawPlan.ok) throw new Error('expected ok');
    expect(rawPlan.value.instructions).toEqual([{ kind: 'CordonNode', nodeId: 'node-7', requestedAt: proposedAt }]);

    // The untrusted-plan-to-typed-instruction gate every domain's
    // planner output must pass through, deterministic rule or not.
    const proposalResult = toPlanProposal<OpsInstruction>(opsInstructionValidators, rawPlan.value, proposedAt);
    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) throw new Error('expected ok');
    const proposal = proposalResult.value;

    // 3. It needs human approval at the 'approval-required' tier —
    // never an outright accept, regardless of how deterministic the
    // source rule was.
    const decision = opsVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    // 4. A permitted identity (either role in opsApprovalPolicy's
    // 'approval-required' list suffices) approves it.
    const identityProvider = createInMemoryIdentityProvider([
      { id: 'lee-sre-lead', displayName: 'Lee (SRE lead)', roles: ['sre-lead'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, opsRiskTiers, EXAMPLE_opsApprovalPolicy, proposal, {
      approverId: 'lee-sre-lead',
      approved: true,
      decidedAt: '2026-08-01T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    // 5. OpsShell.commit() is called. NodeCordoned is recorded, but
    // (unlike SandboxReprovisioned) not forwarded to any real action
    // yet -- see opsShell.ts's own doc comment on why that remains a
    // stub; this test proves the decision-making half, not a K8s call.
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
      telemetryTag: { domain: 'ops', correlationId: 'node-7' },
    });

    expect(outcome).toBe('committed');
    expect(provisioner.reprovisionCalls).toEqual([]);

    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.effects).toEqual([{ kind: 'NodeCordoned', nodeId: 'node-7', requestedAt: proposedAt }]);

    expect(shell.auditLog).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      proposal: { instructions: [{ kind: 'CordonNode', nodeId: 'node-7' }] },
      approval: { approverId: 'lee-sre-lead', approverRole: 'sre-lead' },
    });
  });

  it('an unresolved (impersonated) approval leaves a CordonNode recommendation awaiting approval, never committed', async () => {
    const unhealthyEvent: TelemetryEvent = {
      kind: 'NodeUnhealthy',
      domain: 'ops',
      correlationId: 'node-7',
      recordedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
      pressure: 'DiskPressure',
      sustainedForMs: 300_000,
    };
    const proposedAt = '2026-08-01T00:00:01.000Z';

    const rawPlan = await planCordonNode(unhealthyEvent, proposedAt);
    if (!rawPlan.ok) throw new Error('expected ok');
    const proposalResult = toPlanProposal<OpsInstruction>(opsInstructionValidators, rawPlan.value, proposedAt);
    if (!proposalResult.ok) throw new Error('expected ok');
    const proposal = proposalResult.value;

    const doOutcome = opsEngine.executeSequence(initialContext, proposal.instructions);
    const decision = opsVerifier.verify(proposal);

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'lee-sre-lead', displayName: 'Lee (SRE lead)', roles: ['sre-lead'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, opsRiskTiers, EXAMPLE_opsApprovalPolicy, proposal, {
      approverId: 'someone-pretending-to-be-lee',
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
