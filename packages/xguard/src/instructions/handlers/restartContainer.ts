import type { Handler } from '@xhis/core';
import { ok } from '@xhis/core';
import type { OpsContext, OpsEffect, OpsError, OpsInstruction } from '../types.js';

type RestartContainer = Extract<OpsInstruction, { kind: 'RestartContainer' }>;

/**
 * Stubbed — see `cordonNode.ts`'s doc comment for why: typed and
 * dispatchable, but no tracked container state and no real remediation
 * logic yet. `// TODO: real K8s-backed implementation`.
 */
export const restartContainerHandler: Handler<OpsContext, RestartContainer, OpsEffect, OpsError> = (
  ctx,
  instruction,
) => {
  return ok({
    context: ctx,
    effects: [
      { kind: 'ContainerRestarted', containerId: instruction.containerId, requestedAt: instruction.requestedAt },
    ],
  });
};
