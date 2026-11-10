import type { Handler } from '@xhis/core';
import { ok } from '@xhis/core';
import type { OpsContext, OpsEffect, OpsError, OpsInstruction } from '../types.js';

type CordonNode = Extract<OpsInstruction, { kind: 'CordonNode' }>;

/**
 * Still a pass-through at Do time, like `restartContainer.ts`/
 * `scaleDeployment.ts`: typed and dispatchable so `HandlerRegistry`'s
 * totality check passes, but `OpsContext` has no node-tracking state
 * yet (see `types.ts`'s own doc comment on why only sandboxes are
 * tracked), so this handler has nothing to check or update against —
 * that part of "real K8s-backed" is still deferred (see
 * `docs/XGUARD_INTEGRATION.md`).
 *
 * The `NodeCordoned` effect this returns *does* reach a real cluster
 * now, just one layer up: `agentic/shell/opsShell.ts`'s `commit()`
 * forwards it to a `NodeCordoner` (see `cluster/nodeCordoner.ts`;
 * `cluster/kubernetesNodeCordoner.ts` for the real, K8s-backed one)
 * when one is supplied — this handler doesn't need to know that, the
 * same "Do only ever describes, Act is the one place I/O happens"
 * separation every clinical domain's own handlers already rely on.
 */
export const cordonNodeHandler: Handler<OpsContext, CordonNode, OpsEffect, OpsError> = (ctx, instruction) => {
  return ok({
    context: ctx,
    effects: [{ kind: 'NodeCordoned', nodeId: instruction.nodeId, requestedAt: instruction.requestedAt }],
  });
};
