import { afterEach, describe, expect, it } from 'vitest';
import { deploymentId } from '../../src/instructions/ids.js';
import { createKubernetesDeploymentScaler } from '../../src/cluster/kubernetesDeploymentScaler.js';
import { startFakeKubeApiServer, type FakeKubeApiServer } from './fakeKubeApiServer.js';

/**
 * Same unverified-against-a-real-cluster status as
 * `kubernetesNodeCordoner.test.ts` -- see its own doc comment for what
 * `fakeKubeApiServer.ts` does and doesn't prove.
 */
describe('createKubernetesDeploymentScaler', () => {
  let fake: FakeKubeApiServer | undefined;

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  it('scale() patches only the scale subresource, never the whole Deployment', async () => {
    fake = await startFakeKubeApiServer({
      'PATCH /apis/apps/v1/namespaces/clinic/deployments/lab-worker/scale': {
        status: 200,
        body: { kind: 'Scale', spec: { replicas: 5 }, status: { replicas: 5, selector: 'app=lab-worker' } },
      },
    });
    const scaler = createKubernetesDeploymentScaler(fake.kubeConfig);

    await scaler.scale(deploymentId('clinic/lab-worker'), 5);

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      method: 'PATCH',
      url: '/apis/apps/v1/namespaces/clinic/deployments/lab-worker/scale',
      body: { spec: { replicas: 5 } },
    });
  });

  it('getStatus() reports replicas and readyReplicas from the Deployment status', async () => {
    fake = await startFakeKubeApiServer({
      'GET /apis/apps/v1/namespaces/clinic/deployments/lab-worker': {
        status: 200,
        body: {
          kind: 'Deployment',
          metadata: { name: 'lab-worker', namespace: 'clinic' },
          status: { replicas: 5, readyReplicas: 3 },
        },
      },
    });
    const scaler = createKubernetesDeploymentScaler(fake.kubeConfig);

    await expect(scaler.getStatus(deploymentId('clinic/lab-worker'))).resolves.toEqual({
      deploymentId: 'clinic/lab-worker',
      replicas: 5,
      readyReplicas: 3,
    });
  });

  it('getStatus() reports "unknown" for both fields when the deployment has never been heard of (404)', async () => {
    fake = await startFakeKubeApiServer({
      'GET /apis/apps/v1/namespaces/clinic/deployments/ghost-worker': {
        status: 404,
        body: { kind: 'Status', status: 'Failure', code: 404, message: 'deployments "ghost-worker" not found' },
      },
    });
    const scaler = createKubernetesDeploymentScaler(fake.kubeConfig);

    await expect(scaler.getStatus(deploymentId('clinic/ghost-worker'))).resolves.toEqual({
      deploymentId: 'clinic/ghost-worker',
      replicas: 'unknown',
      readyReplicas: 'unknown',
    });
  });

  it('rejects a malformed deploymentId instead of silently guessing a namespace', async () => {
    fake = await startFakeKubeApiServer({});
    const scaler = createKubernetesDeploymentScaler(fake.kubeConfig);

    await expect(scaler.scale(deploymentId('not-namespaced'), 3)).rejects.toThrow(/not in the expected/);
    expect(fake.requests).toHaveLength(0);
  });
});
