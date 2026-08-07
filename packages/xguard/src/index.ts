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
export { createOpsShell, type OpsCommittedBatch } from './agentic/shell/opsShell.js';

export type { SandboxProvisioner, SandboxStatus } from './sandbox/provisioner.js';
export { createInMemorySandboxProvisioner } from './sandbox/inMemorySandboxProvisioner.js';

export { subscribeOpsTelemetryListener, type OpsTelemetryListenerOptions } from './telemetry/opsTelemetryListener.js';
