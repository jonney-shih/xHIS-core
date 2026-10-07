import { act, createTelemetryHook, isoTimestamp, toPlanProposal } from '@xhis/core';
import type { TelemetryEvent } from '@xhis/core';
import { describe, expect, it } from 'vitest';
import { createOpsPlanner } from '../../src/agentic/planning/opsPlanner.js';
import { opsInstructionValidators } from '../../src/agentic/validation/ops.js';
import { opsVerifier } from '../../src/agentic/verification/ops.js';
import { createOpsShell } from '../../src/agentic/shell/opsShell.js';
import { createShadowOpsShell } from '../../src/agentic/shell/shadowOpsShell.js';
import { opsEngine } from '../../src/instructions/engine.js';
import type { OpsContext, OpsInstruction } from '../../src/instructions/types.js';
import { createInMemorySandboxProvisioner } from '../../src/sandbox/inMemorySandboxProvisioner.js';
import { subscribeOpsTelemetryListener } from '../../src/telemetry/opsTelemetryListener.js';

const initialContext: OpsContext = { sandboxes: {} };

/**
 * The direct, side-by-side proof shadow mode exists for: the identical
 * `SandboxTimeout` -> `ReprovisionSandbox` proposal `sandboxTimeoutRemediation
 * .test.ts` already proves commits *and reaches a real action* through
 * `OpsShell` -- run here through `ShadowOpsShell` instead, with zero
 * changes to the planner, validation, Check, or `act()` itself. Only the
 * shell passed to `act()` differs. This is deliberately the one
 * `OpsInstruction` variant `OpsShell.commit()` *does* forward to a real
 * (if in-memory-backed) action today, so the contrast is real, not
 * already-vacuous the way it would be for the other three.
 */
describe('the same proposal, committed through ShadowOpsShell instead of OpsShell, never reaches a real action', () => {
  async function planReprovisionSandbox() {
    const hook = createTelemetryHook();
    const receivedEvents: TelemetryEvent[] = [];
    const unsubscribe = subscribeOpsTelemetryListener({
      hook,
      domain: 'ops',
      onEvent: (event) => receivedEvents.push(event),
    });

    hook.emit({
      kind: 'SandboxTimeout',
      domain: 'ops',
      correlationId: 'sandbox-42',
      recordedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
      unresponsiveForMs: 45_000,
    });
    unsubscribe();

    const proposedAt = '2026-08-01T00:00:01.000Z';
    const rawPlan = await createOpsPlanner().plan(
      { description: 'self-heal from operational telemetry' },
      { events: receivedEvents },
      proposedAt,
      [],
    );
    if (!rawPlan.ok) throw new Error('expected ok');
    const proposalResult = toPlanProposal<OpsInstruction>(opsInstructionValidators, rawPlan.value, proposedAt);
    if (!proposalResult.ok) throw new Error('expected ok');
    return { proposal: proposalResult.value, proposedAt };
  }

  it('OpsShell really does call the provisioner (the baseline this test contrasts against)', async () => {
    const { proposal, proposedAt } = await planReprovisionSandbox();
    const decision = opsVerifier.verify(proposal);
    const doOutcome = opsEngine.executeSequence(initialContext, proposal.instructions);

    const provisioner = createInMemorySandboxProvisioner();
    const shell = createOpsShell(provisioner);
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: initialContext,
      reexecute: (ctx) => opsEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: proposedAt,
    });

    expect(outcome).toBe('committed');
    expect(provisioner.reprovisionCalls).toEqual(['sandbox-42']);
  });

  it('ShadowOpsShell commits the identical proposal but never calls any provisioner at all', async () => {
    const { proposal, proposedAt } = await planReprovisionSandbox();
    const decision = opsVerifier.verify(proposal);
    const doOutcome = opsEngine.executeSequence(initialContext, proposal.instructions);

    // No provisioner constructed, passed, or reachable here at all --
    // createShadowOpsShell() takes zero arguments.
    const shell = createShadowOpsShell();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: initialContext,
      reexecute: (ctx) => opsEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: proposedAt,
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.effects).toEqual([
      { kind: 'SandboxReprovisioned', sandboxId: 'sandbox-42', requestedAt: proposedAt },
    ]);
    expect(shell.auditLog).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({ commitOutcome: 'committed' });

    // The committed *context* still shows 'reprovisioning' -- that's
    // Do's own deterministic computation (reprovisionSandboxHandler.ts),
    // identical regardless of which shell commits it. What's different
    // is that nothing in the real world acted on it: no
    // SandboxProvisioner was ever constructed, let alone called.
    expect(shell.commits[0]!.context.sandboxes['sandbox-42']).toMatchObject({
      sandboxId: 'sandbox-42',
      status: 'reprovisioning',
    });
  });
});
