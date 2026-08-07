import type { InstructionValidatorRegistry, Result } from '@xhis/core';
import { err, isIsoTimestamp, isNonEmptyString, ok } from '@xhis/core';
import { containerId, deploymentId, isoTimestamp, nodeId, sandboxId } from '../../instructions/ids.js';
import type { OpsInstruction } from '../../instructions/types.js';

type ReprovisionSandbox = Extract<OpsInstruction, { kind: 'ReprovisionSandbox' }>;
type CordonNode = Extract<OpsInstruction, { kind: 'CordonNode' }>;
type RestartContainer = Extract<OpsInstruction, { kind: 'RestartContainer' }>;
type ScaleDeployment = Extract<OpsInstruction, { kind: 'ScaleDeployment' }>;

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * The untrusted-remediation-plan-to-typed-`OpsInstruction` gate — same
 * validator-registry pattern every clinical domain's own
 * `agentic/validation/*.ts` follows in `@xhis/core` (see `bed.ts`
 * there): `opsPlanner.ts`'s raw, untrusted output is exactly as
 * unvalidated-by-default as an LLM's raw JSON would be, deterministic
 * rule-engine or not — reusing `@xhis/core`'s own `isNonEmptyString`/
 * `isIsoTimestamp` shape guards rather than reimplementing them.
 */
function validateReprovisionSandbox(candidate: unknown): Result<ReprovisionSandbox, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['sandboxId'])) issues.push("'sandboxId' must be a non-empty string");
  if (!isIsoTimestamp(c['requestedAt'])) issues.push("'requestedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) return err(issues);

  return ok({
    kind: 'ReprovisionSandbox',
    sandboxId: sandboxId(c['sandboxId'] as string),
    requestedAt: isoTimestamp(c['requestedAt'] as string),
  });
}

function validateCordonNode(candidate: unknown): Result<CordonNode, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['nodeId'])) issues.push("'nodeId' must be a non-empty string");
  if (!isIsoTimestamp(c['requestedAt'])) issues.push("'requestedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) return err(issues);

  return ok({
    kind: 'CordonNode',
    nodeId: nodeId(c['nodeId'] as string),
    requestedAt: isoTimestamp(c['requestedAt'] as string),
  });
}

function validateRestartContainer(candidate: unknown): Result<RestartContainer, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['containerId'])) issues.push("'containerId' must be a non-empty string");
  if (!isIsoTimestamp(c['requestedAt'])) issues.push("'requestedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) return err(issues);

  return ok({
    kind: 'RestartContainer',
    containerId: containerId(c['containerId'] as string),
    requestedAt: isoTimestamp(c['requestedAt'] as string),
  });
}

function validateScaleDeployment(candidate: unknown): Result<ScaleDeployment, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['deploymentId'])) issues.push("'deploymentId' must be a non-empty string");
  if (!isFiniteNonNegativeInteger(c['replicas'])) issues.push("'replicas' must be a non-negative integer");
  if (!isIsoTimestamp(c['requestedAt'])) issues.push("'requestedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) return err(issues);

  return ok({
    kind: 'ScaleDeployment',
    deploymentId: deploymentId(c['deploymentId'] as string),
    replicas: c['replicas'] as number,
    requestedAt: isoTimestamp(c['requestedAt'] as string),
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` —
 * total over `OpsInstruction`, the same compile-time guarantee every
 * other registry in this codebase holds itself to.
 */
export const opsInstructionValidators = {
  ReprovisionSandbox: validateReprovisionSandbox,
  CordonNode: validateCordonNode,
  RestartContainer: validateRestartContainer,
  ScaleDeployment: validateScaleDeployment,
} satisfies InstructionValidatorRegistry<OpsInstruction>;
