import { isoTimestamp } from '@xhis/core';
import { describe, expect, it } from 'vitest';
import { createOpsShell } from '../../../src/agentic/shell/opsShell.js';
import { containerId, deploymentId, nodeId, sandboxId } from '../../../src/instructions/ids.js';
import { createInMemorySandboxProvisioner } from '../../../src/sandbox/inMemorySandboxProvisioner.js';
import type { OpsContext } from '../../../src/instructions/types.js';

const requestedAt = isoTimestamp('2026-08-01T00:00:00.000Z');
const context: OpsContext = { sandboxes: {} };

/**
 * `OpsShell.commit()`'s new forwarding, proved against hand-rolled
 * fakes of `NodeCordoner`/`ContainerRestarter`/`DeploymentScaler` --
 * the real, K8s-backed ones already have their own tests
 * (`tests/cluster/kubernetes*.test.ts`) proving the HTTP call shape;
 * this file only proves `commit()` calls the right one, with the
 * right argument, for the right effect kind, and that omitting
 * `clusterActions` entirely preserves the exact pre-existing
 * record-but-don't-forward behavior every `tests/integration/*.ts`
 * remediation test already relies on.
 */
describe('createOpsShell: clusterActions forwarding', () => {
  it('forwards NodeCordoned to a supplied NodeCordoner', async () => {
    const cordonCalls: string[] = [];
    const shell = createOpsShell(createInMemorySandboxProvisioner(), {
      nodeCordoner: {
        cordon: (id) => {
          cordonCalls.push(id);
        },
        getStatus: (id) => ({ nodeId: id, schedulable: 'unknown' }),
      },
    });

    await shell.commit(context, [{ kind: 'NodeCordoned', nodeId: nodeId('node-7'), requestedAt }]);

    expect(cordonCalls).toEqual(['node-7']);
    expect(shell.commits).toEqual([{ context, effects: [{ kind: 'NodeCordoned', nodeId: 'node-7', requestedAt }] }]);
  });

  it('forwards ContainerRestarted to a supplied ContainerRestarter', async () => {
    const restartCalls: string[] = [];
    const shell = createOpsShell(createInMemorySandboxProvisioner(), {
      containerRestarter: {
        restart: (id) => {
          restartCalls.push(id);
        },
        getStatus: (id) => ({ containerId: id, phase: 'unknown' }),
      },
    });

    await shell.commit(context, [
      { kind: 'ContainerRestarted', containerId: containerId('clinic/web-1/web'), requestedAt },
    ]);

    expect(restartCalls).toEqual(['clinic/web-1/web']);
  });

  it('forwards DeploymentScaled to a supplied DeploymentScaler, with the replica count', async () => {
    const scaleCalls: Array<{ id: string; replicas: number }> = [];
    const shell = createOpsShell(createInMemorySandboxProvisioner(), {
      deploymentScaler: {
        scale: (id, replicas) => {
          scaleCalls.push({ id, replicas });
        },
        getStatus: (id) => ({ deploymentId: id, replicas: 'unknown', readyReplicas: 'unknown' }),
      },
    });

    await shell.commit(context, [
      { kind: 'DeploymentScaled', deploymentId: deploymentId('clinic/lab-worker'), replicas: 5, requestedAt },
    ]);

    expect(scaleCalls).toEqual([{ id: 'clinic/lab-worker', replicas: 5 }]);
  });

  it('without clusterActions, every effect is still recorded but never forwarded -- the exact pre-existing behavior', async () => {
    const shell = createOpsShell(createInMemorySandboxProvisioner());

    await shell.commit(context, [
      { kind: 'NodeCordoned', nodeId: nodeId('node-7'), requestedAt },
      { kind: 'ContainerRestarted', containerId: containerId('clinic/web-1/web'), requestedAt },
      { kind: 'DeploymentScaled', deploymentId: deploymentId('clinic/lab-worker'), replicas: 5, requestedAt },
    ]);

    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.effects).toHaveLength(3);
  });

  it('SandboxReprovisioned still always reaches the SandboxProvisioner, unaffected by clusterActions', async () => {
    const provisioner = createInMemorySandboxProvisioner();
    const shell = createOpsShell(provisioner, {});

    await shell.commit(context, [{ kind: 'SandboxReprovisioned', sandboxId: sandboxId('sandbox-1'), requestedAt }]);

    expect(provisioner.reprovisionCalls).toEqual(['sandbox-1']);
  });
});
