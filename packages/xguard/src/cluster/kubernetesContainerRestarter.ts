import { ApiException, CoreV1Api, type KubeConfig } from '@kubernetes/client-node';
import type { ContainerId } from '../instructions/ids.js';
import type { ContainerRestarter, ContainerStatus } from './containerRestarter.js';
import { parseNamespacedPodContainerRef } from './resourceRef.js';

/**
 * The real, K8s-backed `ContainerRestarter` deferred in
 * `docs/XGUARD_INTEGRATION.md`'s "What's deferred" section — see
 * `containerRestarter.ts`'s own doc comment for why "restart" means
 * deleting the owning pod, not a single-container API call (there
 * isn't one). `containerId` is parsed per `resourceRef.ts`'s
 * documented `"<namespace>/<podName>/<containerName>"` convention;
 * `containerName` is accepted but unused below — kept in the shape so
 * a future caller that actually needs to target one container out of
 * a multi-container pod (not something any instruction in this
 * package constructs yet) isn't blocked on a breaking id-shape change
 * later.
 *
 * Same unverified-against-a-real-cluster status as
 * `kubernetesNodeCordoner.ts` — see its own doc comment.
 */
export function createKubernetesContainerRestarter(kubeConfig: KubeConfig): ContainerRestarter {
  const api = kubeConfig.makeApiClient(CoreV1Api);

  return {
    async restart(containerId: ContainerId) {
      const { namespace, podName } = parseNamespacedPodContainerRef('ContainerId', containerId);
      await api.deleteNamespacedPod({ name: podName, namespace });
    },

    async getStatus(containerId: ContainerId): Promise<ContainerStatus> {
      const { namespace, podName } = parseNamespacedPodContainerRef('ContainerId', containerId);
      try {
        const pod = await api.readNamespacedPod({ name: podName, namespace });
        return { containerId, phase: pod.status?.phase ?? 'unknown' };
      } catch (error) {
        if (error instanceof ApiException && error.code === 404) {
          return { containerId, phase: 'unknown' };
        }
        throw error;
      }
    },
  };
}
