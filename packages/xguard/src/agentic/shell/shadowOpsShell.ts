import type { AuditRecord, ImperativeShell } from '@xhis/core';
import type { OpsContext, OpsEffect, OpsInstruction } from '../../instructions/types.js';
import { assertAllRecordable } from './harnessContract.js';
import type { OpsCommittedBatch } from './opsShell.js';

/**
 * The shadow-mode counterpart to `createOpsShell` — the identical
 * `ImperativeShell<OpsContext, OpsInstruction, OpsEffect>` contract, so
 * `act()`, the planner, Check, and validation need no changes at all
 * to run against this instead; only whatever composes a shell needs to
 * choose which one. `commit()` records the exact same
 * `{ context, effects }` batch `OpsShell` would, and `recordAudit`/
 * `readLatest` behave identically — the audit trail this produces is
 * meant to be directly comparable to what a real run would have
 * produced.
 *
 * The one deliberate omission: this constructor takes no
 * `SandboxProvisioner` at all, not an unused one — there is
 * structurally nothing here to call `reprovision()` on. That is the
 * whole point of shadow mode: every recommendation reaches Plan ->
 * Check -> human approval (where the tier requires one) -> `Act` for
 * real, and gets recorded for review, but no real remediation action
 * ever fires.
 *
 * Today this differs from `OpsShell` in exactly one respect:
 * `SandboxReprovisioned` doesn't reach a real `SandboxProvisioner`
 * here, the same way `NodeCordoned`/`ContainerRestarted`/
 * `DeploymentScaled` already don't reach anything real in `OpsShell`
 * either (see `opsShell.ts`'s own doc comment) — those three are
 * already shadow-equivalent today, not because of anything in this
 * file, but because their own real actions haven't been built yet.
 * Once they are, this file's "record, never act" behavior becomes a
 * genuine difference for all four instruction kinds, not just one.
 *
 * `commit()` also runs every effect through `harnessContract.ts`'s
 * `assertAllRecordable` before recording it — the one piece of that
 * contract that genuinely belongs at this layer (see that file's own
 * doc comment for why payload-validation and safety-tier-checking
 * don't: `commit(context, effects)` never sees the originating
 * instructions or proposal, only what `act()` already fresh-checked).
 * By construction, every real caller goes through `act()`, which never
 * hands this a malformed effect — this throws only if something
 * bypasses that contract entirely, which is exactly the "shadow mode
 * has to be trustworthy evidence, not just convenient" posture this
 * shell exists for. `createFileShadowOpsShell` applies the identical
 * check, via the same shared helper, for the durable counterpart.
 */
export function createShadowOpsShell(): ImperativeShell<OpsContext, OpsInstruction, OpsEffect> & {
  readonly commits: readonly OpsCommittedBatch[];
  readonly auditLog: readonly AuditRecord<OpsInstruction, OpsEffect>[];
} {
  const commits: OpsCommittedBatch[] = [];
  const auditLog: AuditRecord<OpsInstruction, OpsEffect>[] = [];

  return {
    commits,
    auditLog,
    commit(context, effects) {
      assertAllRecordable(effects);
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
