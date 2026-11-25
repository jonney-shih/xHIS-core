import type { AuditRecord, ImperativeShell } from '@xhis/core';
import type { ContainerRestarter } from '../../cluster/containerRestarter.js';
import type { DeploymentScaler } from '../../cluster/deploymentScaler.js';
import type { NodeCordoner } from '../../cluster/nodeCordoner.js';
import type { OpsContext, OpsEffect, OpsInstruction } from '../../instructions/types.js';
import type { SandboxProvisioner } from '../../sandbox/provisioner.js';

export interface OpsCommittedBatch {
  readonly context: OpsContext;
  readonly effects: readonly OpsEffect[];
}

/**
 * Every real, K8s-backed action `commit()` can forward an effect to —
 * each one optional, independently, so a caller that only has (say) a
 * real `NodeCordoner` but no real `DeploymentScaler` yet doesn't need
 * to fake the other two. Omitting all three keeps `commit()`'s
 * behavior exactly what it was before this existed: every effect
 * still gets recorded in `commits`, just never forwarded anywhere —
 * see every pre-existing integration test under `tests/integration/`,
 * none of which passes this parameter at all.
 */
export interface OpsClusterActions {
  readonly nodeCordoner?: NodeCordoner;
  readonly containerRestarter?: ContainerRestarter;
  readonly deploymentScaler?: DeploymentScaler;
}

/**
 * The one real (if in-memory-backed, for `SandboxReprovisioned`)
 * `ImperativeShell` implementation in this package — see `@xhis/core`'s
 * `ImperativeShell` doc comment for the seam this fills, and
 * `agentic/shell/inMemoryShell.ts` there for the in-memory-store half
 * of this pattern, which `commit`/`recordAudit`/`readLatest` below
 * otherwise mirror exactly.
 *
 * `commit()` forwards every effect kind to a real action now, each
 * independently optional via `clusterActions`:
 * `SandboxReprovisioned` always reaches the (for now, in-memory)
 * `SandboxProvisioner`, as before; `NodeCordoned`/`ContainerRestarted`/
 * `DeploymentScaled` reach `clusterActions`' matching K8s-backed
 * action when one is supplied (see `cluster/kubernetes*.ts`), and are
 * otherwise only recorded, exactly as they always were — see
 * `instructions/handlers/cordonNode.ts` and its siblings for why those
 * handlers themselves still have nothing to check against (no real
 * K8s-sourced node/container/deployment state tracked in `OpsContext`
 * yet, same as always; this slice is the forwarding action, not a
 * `Check`-time K8s read).
 *
 * `commit()` is `async` (the interface already allowed `void |
 * Promise<void>` — see `@xhis/core`'s `ImperativeShell` doc comment on
 * why) because a real cluster action is a network call; `act()` always
 * `await`s it, so nothing upstream needed to change for this.
 */
export function createOpsShell(
  provisioner: SandboxProvisioner,
  clusterActions: OpsClusterActions = {},
): ImperativeShell<OpsContext, OpsInstruction, OpsEffect> & {
  readonly commits: readonly OpsCommittedBatch[];
  readonly auditLog: readonly AuditRecord<OpsInstruction, OpsEffect>[];
} {
  const commits: OpsCommittedBatch[] = [];
  const auditLog: AuditRecord<OpsInstruction, OpsEffect>[] = [];

  return {
    commits,
    auditLog,
    async commit(context, effects) {
      for (const effect of effects) {
        if (effect.kind === 'SandboxReprovisioned') {
          provisioner.reprovision(effect.sandboxId);
        } else if (effect.kind === 'NodeCordoned' && clusterActions.nodeCordoner) {
          await clusterActions.nodeCordoner.cordon(effect.nodeId);
        } else if (effect.kind === 'ContainerRestarted' && clusterActions.containerRestarter) {
          await clusterActions.containerRestarter.restart(effect.containerId);
        } else if (effect.kind === 'DeploymentScaled' && clusterActions.deploymentScaler) {
          await clusterActions.deploymentScaler.scale(effect.deploymentId, effect.replicas);
        }
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
