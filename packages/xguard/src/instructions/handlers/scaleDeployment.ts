import type { Handler } from '@xhis/core';
import { ok } from '@xhis/core';
import type { OpsContext, OpsEffect, OpsError, OpsInstruction } from '../types.js';

type ScaleDeployment = Extract<OpsInstruction, { kind: 'ScaleDeployment' }>;

/**
 * Still a pass-through at Do time — see `cordonNode.ts`'s doc comment
 * for why (no tracked deployment state in `OpsContext` yet). The
 * `DeploymentScaled` effect this returns does reach a real cluster now
 * via `agentic/shell/opsShell.ts`'s `commit()`, when a
 * `DeploymentScaler` is supplied (see `cluster/deploymentScaler.ts`;
 * `cluster/kubernetesDeploymentScaler.ts` for the real one) — same
 * "Do describes, Act forwards" separation as `cordonNode.ts`.
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
