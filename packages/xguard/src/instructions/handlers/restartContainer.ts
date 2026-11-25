import type { Handler } from '@xhis/core';
import { ok } from '@xhis/core';
import type { OpsContext, OpsEffect, OpsError, OpsInstruction } from '../types.js';

type RestartContainer = Extract<OpsInstruction, { kind: 'RestartContainer' }>;

/**
 * Still a pass-through at Do time — see `cordonNode.ts`'s doc comment
 * for why (no tracked container state in `OpsContext` yet). The
 * `ContainerRestarted` effect this returns does reach a real cluster
 * now via `agentic/shell/opsShell.ts`'s `commit()`, when a
 * `ContainerRestarter` is supplied (see `cluster/containerRestarter.ts`;
 * `cluster/kubernetesContainerRestarter.ts` for the real one) — same
 * "Do describes, Act forwards" separation as `cordonNode.ts`.
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
