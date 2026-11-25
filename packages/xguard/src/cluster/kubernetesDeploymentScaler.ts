import { ApiException, AppsV1Api, PatchStrategy, setHeaderMiddleware, type KubeConfig } from '@kubernetes/client-node';
import type { DeploymentId } from '../instructions/ids.js';
import type { DeploymentScaleStatus, DeploymentScaler } from './deploymentScaler.js';
import { parseNamespacedName } from './resourceRef.js';

/**
 * The real, K8s-backed `DeploymentScaler` deferred in
 * `docs/XGUARD_INTEGRATION.md`'s "What's deferred" section.
 * `deploymentId` is parsed per `resourceRef.ts`'s documented
 * `"<namespace>/<name>"` convention. `scale()` patches the
 * `scale` subresource rather than the whole `Deployment` object —
 * the same narrower surface `kubectl scale` uses, so a concurrent
 * change to any other field of the deployment (image, env vars, ...)
 * can never be clobbered by a `ScaleDeployment` instruction.
 *
 * Same unverified-against-a-real-cluster status as
 * `kubernetesNodeCordoner.ts` — see its own doc comment.
 */
export function createKubernetesDeploymentScaler(kubeConfig: KubeConfig): DeploymentScaler {
  const api = kubeConfig.makeApiClient(AppsV1Api);

  return {
    async scale(deploymentId: DeploymentId, replicas: number) {
      const { namespace, name } = parseNamespacedName('DeploymentId', deploymentId);
      await api.patchNamespacedDeploymentScale(
        { name, namespace, body: { spec: { replicas } } },
        { middleware: [setHeaderMiddleware('Content-Type', PatchStrategy.StrategicMergePatch)] },
      );
    },

    async getStatus(deploymentId: DeploymentId): Promise<DeploymentScaleStatus> {
      const { namespace, name } = parseNamespacedName('DeploymentId', deploymentId);
      try {
        const deployment = await api.readNamespacedDeployment({ name, namespace });
        return {
          deploymentId,
          replicas: deployment.status?.replicas ?? 0,
          readyReplicas: deployment.status?.readyReplicas ?? 0,
        };
      } catch (error) {
        if (error instanceof ApiException && error.code === 404) {
          return { deploymentId, replicas: 'unknown', readyReplicas: 'unknown' };
        }
        throw error;
      }
    },
  };
}
