import { createFileShell, type FileShellPaths, type ImperativeShell } from '@xhis/core';
import type { OpsContext, OpsEffect, OpsInstruction } from '../../instructions/types.js';
import { assertAllRecordable } from './harnessContract.js';

/**
 * The durable counterpart to `createShadowOpsShell` — same shadow-mode
 * restraint (no `SandboxProvisioner`, nothing here can reach a real
 * action), but backed by `@xhis/core`'s own `createFileShell` instead of
 * an in-memory array, so a shadow run's evidence survives a process
 * restart. This is the whole reason a durable variant is worth having
 * at all: a shadow pilot at a real site is meant to run for days or
 * weeks, not one process's lifetime, and `createShadowOpsShell`'s
 * `commits`/`auditLog` vanish the moment that process exits.
 *
 * `createFileShell` itself has no clinical-domain-specific shape — it
 * never had one, the same way `createInMemoryShell` doesn't — so this
 * reuses it directly rather than duplicating append-only-JSONL storage
 * inside this package. Read a shadow run back with `@xhis/core`'s own
 * `readLatestContext`/`readAuditLog`/`readCommits`, the same functions
 * any other durable-shell consumer in this codebase already uses.
 *
 * `commit()` runs `harnessContract.ts`'s `assertAllRecordable` before
 * ever writing to disk — the identical check `createShadowOpsShell`
 * applies, via the same shared helper, so a corrupted or version-skewed
 * effect fails loudly before a single byte is written, not after.
 */
export function createFileShadowOpsShell(paths: FileShellPaths): ImperativeShell<OpsContext, OpsInstruction, OpsEffect> {
  const fileShell = createFileShell<OpsContext, OpsInstruction, OpsEffect>(paths);

  return {
    commit(context, effects) {
      assertAllRecordable(effects);
      fileShell.commit(context, effects);
    },
    recordAudit(record) {
      fileShell.recordAudit(record);
    },
    readLatest() {
      return fileShell.readLatest();
    },
  };
}
