import { act, createTelemetryHook, isoTimestamp, toPlanProposal } from '@xhis/core';
import type { TelemetryEvent } from '@xhis/core';
import { describe, expect, it } from 'vitest';
import { createOpsPlanner } from '../../src/agentic/planning/opsPlanner.js';
import { opsInstructionValidators } from '../../src/agentic/validation/ops.js';
import { opsVerifier } from '../../src/agentic/verification/ops.js';
import { createOpsShell } from '../../src/agentic/shell/opsShell.js';
import { opsEngine } from '../../src/instructions/engine.js';
import type { OpsContext, OpsInstruction } from '../../src/instructions/types.js';
import { createInMemorySandboxProvisioner } from '../../src/sandbox/inMemorySandboxProvisioner.js';
import { subscribeOpsTelemetryListener } from '../../src/telemetry/opsTelemetryListener.js';

/**
 * `ContainerUnhealthy` -> `RestartContainer`'s own end-to-end trace, the
 * third fully-implemented remediation *decision* path in this package
 * (see `docs/XGUARD_INTEGRATION.md` and `agentic/planning/
 * opsPlanner.ts`'s own doc comment). Same `'auto'`-tier shape
 * `sandboxTimeoutRemediation.test.ts` already proves — Check accepts
 * outright, no human approval needed, the same "reversible and
 * single-resource-scoped" reasoning `policy/riskTiers.ts` gives for
 * both `ReprovisionSandbox` and `RestartContainer`.
 */
describe('ContainerUnhealthy -> RestartContainer remediation, end to end', () => {
  it('emits a ContainerUnhealthy event, plans, verifies at auto tier, and commits through OpsShell', async () => {
    const hook = createTelemetryHook();
    const receivedEvents: TelemetryEvent[] = [];
    const unsubscribe = subscribeOpsTelemetryListener({
      hook,
      domain: 'ops',
      onEvent: (event) => receivedEvents.push(event),
    });

    const unhealthyEvent: TelemetryEvent = {
      kind: 'ContainerUnhealthy',
      domain: 'ops',
      correlationId: 'container-3',
      recordedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
      consecutiveFailures: 5,
    };

    // 1. A fake ContainerUnhealthy event, emitted via @xhis/core's own hook.
    hook.emit(unhealthyEvent);
    unsubscribe();
    expect(receivedEvents).toEqual([unhealthyEvent]);

    // 2. The ops planner proposes RestartContainer for it.
    const planner = createOpsPlanner();
    const proposedAt = '2026-08-01T00:00:01.000Z';
    const rawPlan = await planner.plan(
      { description: 'self-heal from operational telemetry' },
      { events: receivedEvents },
      proposedAt,
      [],
    );
    expect(rawPlan.ok).toBe(true);
    if (!rawPlan.ok) throw new Error('expected ok');
    expect(rawPlan.value.instructions).toEqual([
      { kind: 'RestartContainer', containerId: 'container-3', requestedAt: proposedAt },
    ]);

    // The untrusted-plan-to-typed-instruction gate every domain's
    // planner output must pass through, deterministic rule or not.
    const proposalResult = toPlanProposal<OpsInstruction>(opsInstructionValidators, rawPlan.value, proposedAt);
    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) throw new Error('expected ok');
    const proposal = proposalResult.value;

    // 3. It passes verification at the 'auto' tier.
    const decision = opsVerifier.verify(proposal);
    expect(decision).toEqual({ kind: 'accept' });

    // 4. OpsShell.commit() is called. ContainerRestarted is recorded,
    // but (unlike SandboxReprovisioned) not forwarded to any real
    // action yet -- see opsShell.ts's own doc comment on why that
    // remains a stub; this test proves the decision-making half, not a
    // real container restart.
    const initialContext: OpsContext = { sandboxes: {} };
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
      recordedAt: proposedAt,
      telemetryTag: { domain: 'ops', correlationId: 'container-3' },
    });

    expect(outcome).toBe('committed');
    expect(provisioner.reprovisionCalls).toEqual([]);

    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.effects).toEqual([
      { kind: 'ContainerRestarted', containerId: 'container-3', requestedAt: proposedAt },
    ]);

    expect(shell.auditLog).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      proposal: { instructions: [{ kind: 'RestartContainer', containerId: 'container-3' }] },
    });
  });
});
