import type { Handler } from '@xhis/core';
import { ok } from '@xhis/core';
import type { OpsContext, OpsEffect, OpsError, OpsInstruction } from '../types.js';

type ScaleDeployment = Extract<OpsInstruction, { kind: 'ScaleDeployment' }>;

/**
 * Stubbed — see `cordonNode.ts`'s doc comment for why: typed and
 * dispatchable, but no tracked deployment state and no real remediation
 * logic yet. `// TODO: real K8s-backed implementation`.
 */
export const scaleDeploymentHandler: Handler<OpsContext, ScaleDeployment, OpsEffect, OpsError> = (
  ctx,
  instruction,
) => {
  return ok({
    context: ctx,
    effects: [
      {
        kind: 'DeploymentScaled',
        deploymentId: instruction.deploymentId,
        replicas: instruction.replicas,
        requestedAt: instruction.requestedAt,
      },
    ],
  });
};
