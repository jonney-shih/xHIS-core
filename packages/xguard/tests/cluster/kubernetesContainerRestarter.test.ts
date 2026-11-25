import { afterEach, describe, expect, it } from 'vitest';
import { containerId } from '../../src/instructions/ids.js';
import { createKubernetesContainerRestarter } from '../../src/cluster/kubernetesContainerRestarter.js';
import { startFakeKubeApiServer, type FakeKubeApiServer } from './fakeKubeApiServer.js';

/**
 * Same unverified-against-a-real-cluster status as
 * `kubernetesNodeCordoner.test.ts` -- see its own doc comment for what
 * `fakeKubeApiServer.ts` does and doesn't prove.
 */
describe('createKubernetesContainerRestarter', () => {
  let fake: FakeKubeApiServer | undefined;

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  it('restart() deletes the owning pod -- Kubernetes has no single-container restart API', async () => {
    fake = await startFakeKubeApiServer({
      'DELETE /api/v1/namespaces/clinic/pods/web-7f9c-abc12': {
        status: 200,
        body: { kind: 'Pod', metadata: { name: 'web-7f9c-abc12', namespace: 'clinic' } },
      },
    });
    const restarter = createKubernetesContainerRestarter(fake.kubeConfig);

    await restarter.restart(containerId('clinic/web-7f9c-abc12/web'));

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      method: 'DELETE',
      url: '/api/v1/namespaces/clinic/pods/web-7f9c-abc12',
    });
  });

  it('getStatus() reports the owning pod\'s phase', async () => {
    fake = await startFakeKubeApiServer({
      'GET /api/v1/namespaces/clinic/pods/web-7f9c-abc12': {
        status: 200,
        body: { kind: 'Pod', metadata: { name: 'web-7f9c-abc12' }, status: { phase: 'Running' } },
      },
    });
    const restarter = createKubernetesContainerRestarter(fake.kubeConfig);

    await expect(restarter.getStatus(containerId('clinic/web-7f9c-abc12/web'))).resolves.toEqual({
      containerId: 'clinic/web-7f9c-abc12/web',
      phase: 'Running',
    });
  });

  it('getStatus() reports "unknown" for a pod the cluster has never heard of (404)', async () => {
    fake = await startFakeKubeApiServer({
      'GET /api/v1/namespaces/clinic/pods/ghost-pod': {
        status: 404,
        body: { kind: 'Status', status: 'Failure', code: 404, message: 'pods "ghost-pod" not found' },
      },
    });
    const restarter = createKubernetesContainerRestarter(fake.kubeConfig);

    await expect(restarter.getStatus(containerId('clinic/ghost-pod/web'))).resolves.toEqual({
      containerId: 'clinic/ghost-pod/web',
      phase: 'unknown',
    });
  });

  it('rejects a malformed containerId instead of silently guessing a namespace', async () => {
    fake = await startFakeKubeApiServer({});
    const restarter = createKubernetesContainerRestarter(fake.kubeConfig);

    await expect(restarter.restart(containerId('not-namespaced'))).rejects.toThrow(/not in the expected/);
    expect(fake.requests).toHaveLength(0);
  });
});
