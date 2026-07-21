import { appendJsonLine, ensureParentDirectory, readJsonLines } from '../../core/io/jsonLines.js';
import type { CommittedBatch } from '../../core/io/commitLog.js';
import type { Kinded } from '../../core/execution/kinded.js';
import type { AuditRecord } from './auditRecord.js';
import type { ImperativeShell } from './shell.js';

/** Re-exported, not defined here — see `core/io/commitLog.ts` for why. */
export { readCommits } from '../../core/io/commitLog.js';

export interface FileShellPaths {
  readonly commitsFile: string;
  readonly auditFile: string;
}

/**
 * A real (durable, survives a process restart) `ImperativeShell`, using
 * two append-only JSON Lines files instead of a database — this is
 * deliberately the simplest thing that is actually persistent, not a
 * production-grade store. `commit()` and `recordAudit()` write via
 * `appendFileSync`: synchronous because `ImperativeShell`'s methods are
 * synchronous (see `shell.ts`), and a single `appendFileSync` call is one
 * `write()` syscall, which is atomic at the OS level for data this size —
 * no partial-line writes to worry about under normal operation.
 *
 * What this does *not* provide, on purpose — a real deployment needs to
 * layer these on separately, the same way it would need to pick a real
 * `IdentityProvider` or LLM vendor:
 * - No retention/rotation policy. MOHW's electronic-medical-record
 *   retention rules (multi-year, sometimes indefinite) are a records-
 *   management decision, not something this file format encodes.
 * - No backup, replication, or encryption at rest. Whatever filesystem
 *   `commitsFile`/`auditFile` sit on needs those handled independently.
 * - No concurrent-writer safety beyond a single process appending. Two
 *   processes writing to the same files at once can interleave lines;
 *   nothing here coordinates that.
 * - No corruption recovery: a line that fails to `JSON.parse` on read
 *   throws rather than being silently skipped — losing an audit record
 *   silently is a worse failure than a loud crash for something whose
 *   entire purpose is being a trustworthy trail.
 */
export function createFileShell<
  TCtx,
  TInstruction extends Kinded,
  TEffect,
  TAuditRecord = AuditRecord<TInstruction, TEffect>,
>(paths: FileShellPaths): ImperativeShell<TCtx, TInstruction, TEffect, TAuditRecord> {
  ensureParentDirectory(paths.commitsFile);
  ensureParentDirectory(paths.auditFile);

  return {
    commit(context, effects) {
      appendJsonLine(paths.commitsFile, { context, effects });
    },
    recordAudit(record) {
      appendJsonLine(paths.auditFile, record);
    },
    readLatest() {
      return readLatestContext<TCtx>(paths.commitsFile);
    },
  };
}

/**
 * Reads every audit record, oldest first. `TAuditRecord` defaults to
 * `AuditRecord<TInstruction, TEffect>`, same as `createFileShell` — pass
 * `HumanActionAuditRecord<TInstruction, TEffect>` explicitly to read back
 * a file written by the human-initiated path instead.
 */
export function readAuditLog<TInstruction extends Kinded, TEffect, TAuditRecord = AuditRecord<TInstruction, TEffect>>(
  auditFile: string,
): readonly TAuditRecord[] {
  return readJsonLines<TAuditRecord>(auditFile);
}

/**
 * The most recently committed context, or `undefined` if nothing has ever
 * been committed. Each commit line already carries the *full* post-
 * transition context (not a diff — see `shell.ts`'s `commit` signature),
 * so the last line alone is enough to recover current state; there is no
 * separate snapshot file to keep in sync.
 */
export function readLatestContext<TCtx>(commitsFile: string): TCtx | undefined {
  const commits = readJsonLines<CommittedBatch<TCtx, unknown>>(commitsFile);
  return commits.length > 0 ? (commits[commits.length - 1]!.context as TCtx) : undefined;
}
