import { act, createTelemetryHook, isoTimestamp, toPlanProposal } from '@xhis/core';
import type { TelemetryEvent } from '@xhis/core';
import { describe, expect, it } from 'vitest';
import { createOpsPlanner } from '../../src/agentic/planning/opsPlanner.js';
import { opsInstructionValidators } from '../../src/agentic/validation/ops.js';
import { opsVerifier } from '../../src/agentic/verification/ops.js';
import { createOpsShell } from '../../src/agentic/shell/opsShell.js';
import { opsEngine } from '../../src/instructions/engine.js';
import { sandboxId } from '../../src/instructions/ids.js';
import type { OpsContext, OpsInstruction } from '../../src/instructions/types.js';
import { createInMemorySandboxProvisioner } from '../../src/sandbox/inMemorySandboxProvisioner.js';
import { subscribeOpsTelemetryListener } from '../../src/telemetry/opsTelemetryListener.js';

/**
 * The full, end-to-end trace this package's one fully-implemented path
 * promises (see docs/XGUARD_INTEGRATION.md and `instructions/types.ts`'s
 * own doc comment on `OpsInstruction`): a `SandboxTimeout` telemetry
 * event, emitted on `@xhis/core`'s own hook, reaches all the way
 * through Plan -> Check -> Act to a real (in-memory-backed) sandbox
 * reprovision call and a correlated audit entry — with every seam along
 * the way imported only from `@xhis/core`'s package-level export, never
 * a deep path into its internals (see
 * `tests/architecture/coreBoundary.guard.test.ts`).
 */
describe('SandboxTimeout -> ReprovisionSandbox remediation, end to end', () => {
  it('emits a SandboxTimeout event, plans, verifies at auto tier, and commits through OpsShell to the provisioner', async () => {
    const hook = createTelemetryHook();
    const receivedEvents: TelemetryEvent[] = [];
    const unsubscribe = subscribeOpsTelemetryListener({
      hook,
      domain: 'ops',
      onEvent: (event) => receivedEvents.push(event),
    });

    const timeoutEvent: TelemetryEvent = {
      kind: 'SandboxTimeout',
      domain: 'ops',
      correlationId: 'sandbox-42',
      recordedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
      unresponsiveForMs: 45_000,
    };

    // 1. A fake SandboxTimeoutEvent, emitted via @xhis/core's own hook.
    hook.emit(timeoutEvent);
    unsubscribe();

    expect(receivedEvents).toEqual([timeoutEvent]);

    // 2. The ops planner proposes ReprovisionSandbox for it.
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
      { kind: 'ReprovisionSandbox', sandboxId: 'sandbox-42', requestedAt: proposedAt },
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

    // 4. OpsShell.commit() is called, which calls the in-memory
    // provisioner and records an audit entry correlated by the
    // original instruction id (the sandboxId the event named).
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
      telemetryTag: { domain: 'ops', correlationId: 'sandbox-42' },
    });

    expect(outcome).toBe('committed');

    // The provisioner actually got the reprovision call.
    expect(provisioner.reprovisionCalls).toEqual(['sandbox-42']);
    expect(provisioner.getStatus(sandboxId('sandbox-42'))).toEqual({ sandboxId: 'sandbox-42', state: 'reprovisioning' });

    // The committed context reflects it too.
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.sandboxes['sandbox-42']).toMatchObject({
      sandboxId: 'sandbox-42',
      status: 'reprovisioning',
    });

    // The audit entry is correlated back to the original instruction —
    // the same `sandboxId` the triggering telemetry event named.
    expect(shell.auditLog).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      proposal: {
        instructions: [{ kind: 'ReprovisionSandbox', sandboxId: 'sandbox-42' }],
      },
    });
  });
});
