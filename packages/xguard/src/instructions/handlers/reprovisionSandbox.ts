import type { Handler } from '@xhis/core';
import { ok } from '@xhis/core';
import type { OpsContext, OpsEffect, OpsError, OpsInstruction } from '../types.js';

type ReprovisionSandbox = Extract<OpsInstruction, { kind: 'ReprovisionSandbox' }>;

/**
 * The one fully-implemented Do step in this package — marks the
 * sandbox `reprovisioning` in `OpsContext` and emits the effect
 * `agentic/shell/opsShell.ts`'s `commit()` reacts to by calling the
 * real (for now, in-memory) `SandboxProvisioner`. Unconditionally `ok`:
 * unlike a clinical domain's bed/lab records, nothing about this first
 * slice needs the *existing* record to already exist or be in a
 * particular state — reprovisioning an unknown or already-reprovisioning
 * sandbox is still a well-formed request to a K8s-backed provisioner in
 * the real system this stands in for.
 */
export const reprovisionSandboxHandler: Handler<OpsContext, ReprovisionSandbox, OpsEffect, OpsError> = (
  ctx,
  instruction,
) => {
  const context: OpsContext = {
    sandboxes: {
      ...ctx.sandboxes,
      [instruction.sandboxId]: {
        sandboxId: instruction.sandboxId,
        status: 'reprovisioning',
        lastRequestedAt: instruction.requestedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'SandboxReprovisioned',
        sandboxId: instruction.sandboxId,
        requestedAt: instruction.requestedAt,
      },
    ],
  });
};
