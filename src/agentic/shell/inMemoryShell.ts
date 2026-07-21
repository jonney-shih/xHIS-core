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
 *
 * `TAuditRecord` defaults to `AuditRecord<TInstruction, TEffect>`, same as
 * `ImperativeShell` itself — every existing 3-type-argument call site
 * keeps compiling unchanged; `src/human/actHuman.ts` supplies
 * `HumanActionAuditRecord` explicitly instead.
 */
export function createInMemoryShell<
  TCtx,
  TInstruction extends Kinded,
  TEffect,
  TAuditRecord = AuditRecord<TInstruction, TEffect>,
>(): ImperativeShell<TCtx, TInstruction, TEffect, TAuditRecord> & {
  readonly commits: readonly CommittedBatch<TCtx, TEffect>[];
  readonly auditLog: readonly TAuditRecord[];
} {
  const commits: CommittedBatch<TCtx, TEffect>[] = [];
  const auditLog: TAuditRecord[] = [];

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
