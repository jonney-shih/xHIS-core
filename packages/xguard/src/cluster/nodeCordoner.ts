import type { NodeId } from '../instructions/ids.js';

export interface NodeStatus {
  readonly nodeId: NodeId;
  /** `'unknown'` for a node the cordoner has never heard of (or no
   * longer exists in the cluster), the same "unknown, not an error"
   * convention `sandbox/provisioner.ts`'s `SandboxStatus` already uses. */
  readonly schedulable: boolean | 'unknown';
}

/**
 * The seam a real, K8s-backed node-cordon action plugs in behind —
 * `sandbox/provisioner.ts`'s own doc comment and
 * `docs/XGUARD_INTEGRATION.md`'s "What's deferred" section both named
 * this as the next concrete lifecycle interface worth introducing,
 * once cordoning for real was worth building. Same shape convention as
 * `SandboxProvisioner`: one fire-and-forget action, one separate
 * status read, deliberately not a single call that does both.
 *
 * `instructions/handlers/cordonNode.ts` never calls this directly —
 * only `agentic/shell/opsShell.ts`'s `commit()` does, the same
 * "nothing above the provisioner seam needs to change" discipline
 * `SandboxProvisioner` already follows.
 */
export interface NodeCordoner {
  /** Marks the node unschedulable — the same effect `kubectl cordon`
   * has. Does not evict or otherwise touch pods already running on it. */
  cordon(nodeId: NodeId): void | Promise<void>;
  getStatus(nodeId: NodeId): NodeStatus | Promise<NodeStatus>;
}
