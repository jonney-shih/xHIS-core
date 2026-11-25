import type { DeploymentId } from '../instructions/ids.js';

export interface DeploymentScaleStatus {
  readonly deploymentId: DeploymentId;
  /** `'unknown'` for either field when the deployment can't be found
   * — the same "unknown, not an error" convention `NodeStatus`/
   * `ContainerStatus`/`sandbox/provisioner.ts`'s `SandboxStatus` use. */
  readonly replicas: number | 'unknown';
  readonly readyReplicas: number | 'unknown';
}

/**
 * The seam a real, K8s-backed deployment-scale action plugs in behind
 * — see `NodeCordoner`'s own doc comment for the identical "deferred
 * lifecycle interface" reasoning, now for `ScaleDeployment` instead of
 * `CordonNode`.
 */
export interface DeploymentScaler {
  /** Patches the deployment's `spec.replicas`. Fire-and-forget: how
   * many replicas are actually ready afterward is observed later via
   * `getStatus`, the same contract `SandboxProvisioner.reprovision`
   * and `NodeCordoner.cordon` already use. */
  scale(deploymentId: DeploymentId, replicas: number): void | Promise<void>;
  getStatus(deploymentId: DeploymentId): DeploymentScaleStatus | Promise<DeploymentScaleStatus>;
}
