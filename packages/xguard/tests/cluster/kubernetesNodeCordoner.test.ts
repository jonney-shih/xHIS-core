import { afterEach, describe, expect, it } from 'vitest';
import { nodeId } from '../../src/instructions/ids.js';
import { createKubernetesNodeCordoner } from '../../src/cluster/kubernetesNodeCordoner.js';
import { startFakeKubeApiServer, type FakeKubeApiServer } from './fakeKubeApiServer.js';

/**
 * No real Kubernetes cluster is available to this workspace (see
 * `docs/XGUARD_INTEGRATION.md`'s "What's deferred", and the project's
 * own accepted Phase 0 gap) -- these tests prove the real HTTP call
 * `createKubernetesNodeCordoner` makes has the right method, path, and
 * body against `fakeKubeApiServer.ts`'s hand-rolled stand-in for the
 * K8s API server, the same "proves the shape, not a live cluster"
 * honesty `postgres-shell`'s own tests carried before its first real
 * Postgres run. RBAC, admission control, and whether a real `kubelet`
 * actually honors `unschedulable` are all out of scope here.
 */
describe('createKubernetesNodeCordoner', () => {
  let fake: FakeKubeApiServer | undefined;

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  it('cordon() sends a strategic-merge-patch PATCH to /api/v1/nodes/{name} setting spec.unschedulable', async () => {
    fake = await startFakeKubeApiServer({
      'PATCH /api/v1/nodes/node-7': {
        status: 200,
        body: { kind: 'Node', metadata: { name: 'node-7' }, spec: { unschedulable: true } },
      },
    });
    const cordoner = createKubernetesNodeCordoner(fake.kubeConfig);

    await cordoner.cordon(nodeId('node-7'));

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      method: 'PATCH',
      url: '/api/v1/nodes/node-7',
      body: { spec: { unschedulable: true } },
    });
  });

  it('getStatus() reports schedulable: false for a node with spec.unschedulable set', async () => {
    fake = await startFakeKubeApiServer({
      'GET /api/v1/nodes/node-7': {
        status: 200,
        body: { kind: 'Node', metadata: { name: 'node-7' }, spec: { unschedulable: true } },
      },
    });
    const cordoner = createKubernetesNodeCordoner(fake.kubeConfig);

    await expect(cordoner.getStatus(nodeId('node-7'))).resolves.toEqual({ nodeId: 'node-7', schedulable: false });
  });

  it('getStatus() reports schedulable: true for a node with no unschedulable field', async () => {
    fake = await startFakeKubeApiServer({
      'GET /api/v1/nodes/node-8': {
        status: 200,
        body: { kind: 'Node', metadata: { name: 'node-8' }, spec: {} },
      },
    });
    const cordoner = createKubernetesNodeCordoner(fake.kubeConfig);

    await expect(cordoner.getStatus(nodeId('node-8'))).resolves.toEqual({ nodeId: 'node-8', schedulable: true });
  });

  it('getStatus() reports schedulable: "unknown" for a node the cluster has never heard of (404), the same "unknown, not an error" contract SandboxStatus already uses', async () => {
    fake = await startFakeKubeApiServer({
      'GET /api/v1/nodes/ghost-node': {
        status: 404,
        body: { kind: 'Status', status: 'Failure', code: 404, message: 'nodes "ghost-node" not found' },
      },
    });
    const cordoner = createKubernetesNodeCordoner(fake.kubeConfig);

    await expect(cordoner.getStatus(nodeId('ghost-node'))).resolves.toEqual({
      nodeId: 'ghost-node',
      schedulable: 'unknown',
    });
  });
});
