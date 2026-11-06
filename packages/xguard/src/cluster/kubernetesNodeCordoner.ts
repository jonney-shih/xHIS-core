import { ApiException, CoreV1Api, PatchStrategy, setHeaderMiddleware, type KubeConfig } from '@kubernetes/client-node';
import type { NodeId } from '../instructions/ids.js';
import type { NodeCordoner, NodeStatus } from './nodeCordoner.js';

/**
 * The real, K8s-backed `NodeCordoner` deferred in `sandbox/
 * provisioner.ts`'s own doc comment and `docs/XGUARD_INTEGRATION.md`'s
 * "What's deferred" section. Cordoning a node means setting
 * `spec.unschedulable = true` — the same effect `kubectl cordon` has,
 * nothing more: pods already running on the node keep running; only
 * the scheduler stops placing new ones there. This package never
 * *un*cordons a node — nothing in `OpsInstruction` models that action
 * (see `instructions/types.ts`).
 *
 * No cluster is available to this workspace to verify this against —
 * a known, explicitly accepted gap, the same honestly-unverified
 * status `packages/postgres-shell` carried before its own first
 * real-cluster pressure test. `kubernetesNodeCordoner.test.ts` proves
 * the right call is made with the right shape against a hand-rolled
 * fake `CoreV1Api`, not that a real cluster accepts it.
 */
export function createKubernetesNodeCordoner(kubeConfig: KubeConfig): NodeCordoner {
  const api = kubeConfig.makeApiClient(CoreV1Api);

  return {
    async cordon(nodeId: NodeId) {
      await api.patchNode(
        { name: nodeId, body: { spec: { unschedulable: true } } },
        { middleware: [setHeaderMiddleware('Content-Type', PatchStrategy.StrategicMergePatch)] },
      );
    },

    async getStatus(nodeId: NodeId): Promise<NodeStatus> {
      try {
        const node = await api.readNode({ name: nodeId });
        return { nodeId, schedulable: node.spec?.unschedulable === true ? false : true };
      } catch (error) {
        if (error instanceof ApiException && error.code === 404) {
          return { nodeId, schedulable: 'unknown' };
        }
        throw error;
      }
    },
  };
}
