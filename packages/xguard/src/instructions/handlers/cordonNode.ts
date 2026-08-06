import type { Handler } from '@xhis/core';
import { ok } from '@xhis/core';
import type { OpsContext, OpsEffect, OpsError, OpsInstruction } from '../types.js';

type CordonNode = Extract<OpsInstruction, { kind: 'CordonNode' }>;

/**
 * Stubbed, like `restartContainer.ts`/`scaleDeployment.ts`: typed and
 * dispatchable so `HandlerRegistry`'s totality check passes, but
 * `OpsContext` has no node-tracking state yet (see `types.ts`'s own doc
 * comment on why only sandboxes are tracked), so this handler has
 * nothing to check or update — a pass-through that only proves the
 * instruction reaches Do. `// TODO: real K8s-backed implementation` —
 * cordoning a node for real, and tracking its state here, is deferred
 * to a follow-up (see docs/XGUARD_INTEGRATION.md).
 */
export const cordonNodeHandler: Handler<OpsContext, CordonNode, OpsEffect, OpsError> = (ctx, instruction) => {
  return ok({
    context: ctx,
    effects: [{ kind: 'NodeCordoned', nodeId: instruction.nodeId, requestedAt: instruction.requestedAt }],
  });
};
