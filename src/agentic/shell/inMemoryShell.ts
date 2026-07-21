import type { Kinded } from '../../core/execution/kinded.js';
import type { AuditRecord } from './auditRecord.js';
import type { ImperativeShell } from './shell.js';

/** Re-exported, not defined here — see `core/io/commitLog.ts` for why. */
export type { CommittedBatch } from '../../core/io/commitLog.js';
import type { CommittedBatch } from '../../core/io/commitLog.js';

/**
 * Records commits and audit entries in memory instead of performing real
 * I/O. Exists for tests and for exercising Act end-to-end before a real
 * shell (a database, an audit log service, ...) is built — see
 * docs/AGENTIC_LAYER.md.
 */
export function createInMemoryShell<TCtx, TInstruction extends Kinded, TEffect>(): ImperativeShell<
  TCtx,
  TInstruction,
  TEffect
> & {
  readonly commits: readonly CommittedBatch<TCtx, TEffect>[];
  readonly auditLog: readonly AuditRecord<TInstruction, TEffect>[];
} {
  const commits: CommittedBatch<TCtx, TEffect>[] = [];
  const auditLog: AuditRecord<TInstruction, TEffect>[] = [];

  return {
    commits,
    auditLog,
    commit(context, effects) {
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
