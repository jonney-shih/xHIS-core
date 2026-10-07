import { isoTimestamp, toPlanProposal } from '@xhis/core';
import { describe, expect, it } from 'vitest';
import {
  assertRecordableEffect,
  checkShadowRunSafety,
  validateShadowRunPayload,
} from '../../../src/agentic/shell/harnessContract.js';
import { opsInstructionValidators } from '../../../src/agentic/validation/ops.js';
import { containerId, deploymentId, nodeId, sandboxId } from '../../../src/instructions/ids.js';
import type { OpsEffect, OpsInstruction } from '../../../src/instructions/types.js';

describe('validateShadowRunPayload', () => {
  it('accepts one well-formed candidate of each OpsInstruction kind', () => {
    const result = validateShadowRunPayload([
      { kind: 'ReprovisionSandbox', sandboxId: 'sandbox-1', requestedAt: '2026-08-01T00:00:00.000Z' },
      { kind: 'CordonNode', nodeId: 'node-1', requestedAt: '2026-08-01T00:00:00.000Z' },
      { kind: 'RestartContainer', containerId: 'container-1', requestedAt: '2026-08-01T00:00:00.000Z' },
      { kind: 'ScaleDeployment', deploymentId: 'deployment-1', replicas: 3, requestedAt: '2026-08-01T00:00:00.000Z' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual([
      { kind: 'ReprovisionSandbox', sandboxId: 'sandbox-1', requestedAt: '2026-08-01T00:00:00.000Z' },
      { kind: 'CordonNode', nodeId: 'node-1', requestedAt: '2026-08-01T00:00:00.000Z' },
      { kind: 'RestartContainer', containerId: 'container-1', requestedAt: '2026-08-01T00:00:00.000Z' },
      { kind: 'ScaleDeployment', deploymentId: 'deployment-1', replicas: 3, requestedAt: '2026-08-01T00:00:00.000Z' },
    ]);
  });

  it('collects issues from every invalid candidate, not just the first', () => {
    const result = validateShadowRunPayload([
      { kind: 'ReprovisionSandbox', requestedAt: '2026-08-01T00:00:00.000Z' }, // missing sandboxId
      { kind: 'CordonNode', nodeId: 'node-1', requestedAt: 'not-a-timestamp' }, // bad requestedAt
      { kind: 'ScaleDeployment', deploymentId: 'deployment-1', replicas: -1, requestedAt: '2026-08-01T00:00:00.000Z' }, // negative replicas
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toHaveLength(3);
    expect(result.error.map((failure) => failure.index)).toEqual([0, 1, 2]);
  });

  it('rejects an unknown instruction kind', () => {
    const result = validateShadowRunPayload([{ kind: 'DeleteEverything', requestedAt: '2026-08-01T00:00:00.000Z' }]);

    expect(result.ok).toBe(false);
  });

  it('agrees with opsInstructionValidators on the same well-formed candidate', () => {
    const candidate = { kind: 'CordonNode', nodeId: 'node-1', requestedAt: '2026-08-01T00:00:00.000Z' };

    const viaHarness = validateShadowRunPayload([candidate]);
    const viaHandRolled = opsInstructionValidators.CordonNode(candidate);

    expect(viaHarness.ok).toBe(true);
    expect(viaHandRolled.ok).toBe(true);
    if (!viaHarness.ok || !viaHandRolled.ok) throw new Error('expected both ok');
    expect(viaHarness.value[0]).toEqual(viaHandRolled.value);
  });
});

describe('checkShadowRunSafety', () => {
  function proposalFor(instructions: readonly unknown[]) {
    const result = toPlanProposal<OpsInstruction>(
      opsInstructionValidators,
      {
        instructions,
        rationale: 'test',
        modelVersion: 'test-v1',
        promptVersion: 'test-v1',
      },
      '2026-08-01T00:00:00.000Z',
    );
    if (!result.ok) throw new Error('expected ok');
    return result.value;
  }

  it('accepts a ReprovisionSandbox proposal outright, at the auto tier', () => {
    const decision = checkShadowRunSafety(
      proposalFor([{ kind: 'ReprovisionSandbox', sandboxId: 'sandbox-1', requestedAt: '2026-08-01T00:00:00.000Z' }]),
    );

    expect(decision).toEqual({ kind: 'accept' });
  });

  it('needs human approval for a CordonNode proposal, at the approval-required tier', () => {
    const decision = checkShadowRunSafety(
      proposalFor([{ kind: 'CordonNode', nodeId: 'node-1', requestedAt: '2026-08-01T00:00:00.000Z' }]),
    );

    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });
});

describe('assertRecordableEffect', () => {
  it('accepts each of the four known OpsEffect kinds', () => {
    const requestedAt = isoTimestamp('2026-08-01T00:00:00.000Z');
    const effects: readonly OpsEffect[] = [
      { kind: 'SandboxReprovisioned', sandboxId: sandboxId('sandbox-1'), requestedAt },
      { kind: 'NodeCordoned', nodeId: nodeId('node-1'), requestedAt },
      { kind: 'ContainerRestarted', containerId: containerId('container-1'), requestedAt },
      { kind: 'DeploymentScaled', deploymentId: deploymentId('deployment-1'), replicas: 3, requestedAt },
    ];

    for (const effect of effects) {
      expect(assertRecordableEffect(effect)).toEqual({ ok: true, value: effect });
    }
  });

  it('rejects a corrupted effect that bypassed compile-time checking', () => {
    // Standing in for a value that slipped past TypeScript entirely --
    // a version-skewed caller, a JSON round-trip, or direct misuse of
    // an ImperativeShell by something that isn't act().
    const corrupted = { kind: 'DeleteEverything', requestedAt: '2026-08-01T00:00:00.000Z' } as unknown as OpsEffect;

    const result = assertRecordableEffect(corrupted);

    expect(result.ok).toBe(false);
  });

  it('rejects a known effect kind whose fields are themselves malformed', () => {
    const corrupted = { kind: 'ScaleDeployment', deploymentId: 'deployment-1', replicas: -1, requestedAt: '2026-08-01T00:00:00.000Z' } as unknown as OpsEffect;

    const result = assertRecordableEffect(corrupted);

    expect(result.ok).toBe(false);
  });
});
