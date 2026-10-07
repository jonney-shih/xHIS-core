import { isoTimestamp } from '@xhis/core';
import { describe, expect, it } from 'vitest';
import { createShadowOpsShell } from '../../../src/agentic/shell/shadowOpsShell.js';
import { containerId, deploymentId, nodeId, sandboxId } from '../../../src/instructions/ids.js';
import type { OpsContext, OpsEffect } from '../../../src/instructions/types.js';

const requestedAt = isoTimestamp('2026-08-01T00:00:00.000Z');

describe('createShadowOpsShell', () => {
  it('records a committed batch, the same shape OpsShell would', () => {
    const shell = createShadowOpsShell();
    const context: OpsContext = { sandboxes: { 'sandbox-1': { sandboxId: sandboxId('sandbox-1'), status: 'reprovisioning' } } };
    const effects: readonly OpsEffect[] = [{ kind: 'SandboxReprovisioned', sandboxId: sandboxId('sandbox-1'), requestedAt }];

    shell.commit(context, effects);

    expect(shell.commits).toEqual([{ context, effects }]);
  });

  it('records every OpsEffect kind without complaint — none of them reach a real action', () => {
    const shell = createShadowOpsShell();
    const context: OpsContext = { sandboxes: {} };

    shell.commit(context, [{ kind: 'NodeCordoned', nodeId: nodeId('node-1'), requestedAt }]);
    shell.commit(context, [{ kind: 'ContainerRestarted', containerId: containerId('container-1'), requestedAt }]);
    shell.commit(context, [{ kind: 'DeploymentScaled', deploymentId: deploymentId('deployment-1'), replicas: 5, requestedAt }]);

    expect(shell.commits).toHaveLength(3);
  });

  it('throws rather than silently recording an effect that bypassed the harness contract', () => {
    const shell = createShadowOpsShell();
    const corrupted = { kind: 'DeleteEverything', requestedAt } as unknown as OpsEffect;

    expect(() => shell.commit({ sandboxes: {} }, [corrupted])).toThrow(/refused to record/);
    expect(shell.commits).toHaveLength(0);
  });

  it('recordAudit stores audit records, and readLatest tracks the most recent commit', () => {
    const shell = createShadowOpsShell();
    expect(shell.readLatest()).toBeUndefined();

    const first: OpsContext = { sandboxes: { a: { sandboxId: sandboxId('a'), status: 'reprovisioning' } } };
    const second: OpsContext = { sandboxes: { b: { sandboxId: sandboxId('b'), status: 'reprovisioning' } } };
    shell.commit(first, []);
    shell.commit(second, []);

    expect(shell.readLatest()).toBe(second);

    shell.recordAudit({
      proposal: { instructions: [], rationale: 'x', modelVersion: 'v1', promptVersion: 'v1', proposedAt: requestedAt },
      decision: { kind: 'accept' },
      commitOutcome: 'committed',
      reasons: [],
      effects: [],
      recordedAt: requestedAt,
    });
    expect(shell.auditLog).toHaveLength(1);
  });

  it("takes no SandboxProvisioner at all -- there is nothing here for 'SandboxReprovisioned' to reach", () => {
    // createShadowOpsShell() takes zero arguments, unlike createOpsShell(provisioner)
    // -- this is a compile-time guarantee (see the file's own doc comment),
    // demonstrated here by simply calling it with none.
    const shell = createShadowOpsShell();
    expect(typeof shell.commit).toBe('function');
  });
});
