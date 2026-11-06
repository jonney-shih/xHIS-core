import type { ContainerId } from '../instructions/ids.js';

export interface ContainerStatus {
  readonly containerId: ContainerId;
  /** The owning pod's phase, or `'unknown'` if the pod can't be found
   * — the same "unknown, not an error" convention `NodeStatus` and
   * `sandbox/provisioner.ts`'s `SandboxStatus` already use. Kubernetes
   * has no API for the state of one container in isolation; a pod's
   * phase is the closest real signal there is. */
  readonly phase: string | 'unknown';
}

/**
 * The seam a real, K8s-backed container-restart action plugs in
 * behind — see `NodeCordoner`'s own doc comment for the identical
 * "deferred lifecycle interface" reasoning, now for `RestartContainer`
 * instead of `CordonNode`.
 */
export interface ContainerRestarter {
  /** Restarts the container. Kubernetes has no API to restart a single
   * container in place — a real implementation does this by deleting
   * the owning pod, relying on whatever controller manages it
   * (Deployment, ReplicaSet, ...) to recreate it. Fire-and-forget: the
   * replacement pod's readiness is observed later via `getStatus`,
   * the same contract `SandboxProvisioner.reprovision` already uses. */
  restart(containerId: ContainerId): void | Promise<void>;
  getStatus(containerId: ContainerId): ContainerStatus | Promise<ContainerStatus>;
}
