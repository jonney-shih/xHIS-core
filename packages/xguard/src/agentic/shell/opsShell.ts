import type { AuditRecord, ImperativeShell } from '@xhis/core';
import type { OpsContext, OpsEffect, OpsInstruction } from '../../instructions/types.js';
import type { SandboxProvisioner } from '../../sandbox/provisioner.js';

export interface OpsCommittedBatch {
  readonly context: OpsContext;
  readonly effects: readonly OpsEffect[];
}

/**
 * The one real (if in-memory-backed) `ImperativeShell` implementation
 * in this package — see `@xhis/core`'s `ImperativeShell` doc comment
 * for the seam this fills, and `agentic/shell/inMemoryShell.ts` there
 * for the in-memory-store half of this pattern, which `commit`/
 * `recordAudit`/`readLatest` below otherwise mirror exactly.
 *
 * The one genuinely new piece: `commit()` also calls into a
 * `SandboxProvisioner` for every `SandboxReprovisioned` effect in the
 * batch being committed — this is the actual self-healing action, not
 * just a record of one. Every other effect kind is stored but not
 * (yet) forwarded anywhere — see `instructions/handlers/cordonNode.ts`
 * and its siblings for why those remain stubs.
 */
export function createOpsShell(
  provisioner: SandboxProvisioner,
): ImperativeShell<OpsContext, OpsInstruction, OpsEffect> & {
  readonly commits: readonly OpsCommittedBatch[];
  readonly auditLog: readonly AuditRecord<OpsInstruction, OpsEffect>[];
} {
  const commits: OpsCommittedBatch[] = [];
  const auditLog: AuditRecord<OpsInstruction, OpsEffect>[] = [];

  return {
    commits,
    auditLog,
    commit(context, effects) {
      for (const effect of effects) {
        if (effect.kind === 'SandboxReprovisioned') {
          provisioner.reprovision(effect.sandboxId);
        }
        // TODO: real K8s-backed handling for NodeCordoned/
        // ContainerRestarted/DeploymentScaled — see
        // `sandbox/provisioner.ts`'s own doc comment; these effects are
        // recorded below (as part of `commits`) but not yet forwarded
        // to any real remediation action.
      }
      commits.push({ context, effects });
    },
    recordAudit(record) {
      auditLog.push(record);
    },
    readLatest() {
      return commits.length > 0 ? commits[commits.length - 1]!.context : undefined;
    },
  };
}
