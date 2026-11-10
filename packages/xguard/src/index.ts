/**
 * `@xhis/xguard`'s public export surface. Not load-bearing the way
 * `@xhis/core`'s own `index.ts` is (nothing in this repository depends
 * on `@xhis/xguard` yet), but kept anyway, for the same reason: a
 * future consumer (an ops dashboard, a real deployment's bootstrap
 * code) should have one seam to import from rather than reaching into
 * this package's internals.
 */

export type {
  ContainerId,
  DeploymentId,
  IsoTimestamp,
  NodeId,
  SandboxId,
} from './instructions/ids.js';
export { containerId, deploymentId, isoTimestamp, nodeId, sandboxId } from './instructions/ids.js';
export type { OpsContext, OpsEffect, OpsError, OpsInstruction, SandboxRecord } from './instructions/types.js';
export { opsHandlerRegistry } from './instructions/handlers/index.js';
export { opsEngine } from './instructions/engine.js';

export { opsRiskTiers } from './policy/riskTiers.js';
export { EXAMPLE_opsApprovalPolicy } from './policy/approvalPolicy.js';

export { opsInstructionValidators } from './agentic/validation/ops.js';
export { createBlastRadiusPlaceholderVerifier, opsVerifier } from './agentic/verification/ops.js';
export { createOpsPlanner, type OpsRemediationContext } from './agentic/planning/opsPlanner.js';
export { createOpsShell, type OpsClusterActions, type OpsCommittedBatch } from './agentic/shell/opsShell.js';
export { createShadowOpsShell } from './agentic/shell/shadowOpsShell.js';
export { createFileShadowOpsShell } from './agentic/shell/fileShadowOpsShell.js';
export {
  assertAllRecordable,
  assertRecordableEffect,
  checkShadowRunSafety,
  validateShadowRunPayload,
  type HarnessViolation,
  type IndexedShadowValidationIssues,
} from './agentic/shell/harnessContract.js';

export type { SandboxProvisioner, SandboxStatus } from './sandbox/provisioner.js';
export { createInMemorySandboxProvisioner } from './sandbox/inMemorySandboxProvisioner.js';

export type { NodeCordoner, NodeStatus } from './cluster/nodeCordoner.js';
export { createKubernetesNodeCordoner } from './cluster/kubernetesNodeCordoner.js';
export type { ContainerRestarter, ContainerStatus } from './cluster/containerRestarter.js';
export { createKubernetesContainerRestarter } from './cluster/kubernetesContainerRestarter.js';
export type { DeploymentScaleStatus, DeploymentScaler } from './cluster/deploymentScaler.js';
export { createKubernetesDeploymentScaler } from './cluster/kubernetesDeploymentScaler.js';
export {
  MalformedResourceIdError,
  parseNamespacedName,
  parseNamespacedPodContainerRef,
  type NamespacedName,
  type NamespacedPodContainerRef,
} from './cluster/resourceRef.js';

export { subscribeOpsTelemetryListener, type OpsTelemetryListenerOptions } from './telemetry/opsTelemetryListener.js';
