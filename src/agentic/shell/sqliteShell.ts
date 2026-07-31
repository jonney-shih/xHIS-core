import { createRequire } from 'node:module';
import type { Kinded } from '../../core/execution/kinded.js';
import type { AuditRecord } from './auditRecord.js';
import type { ImperativeShell } from './shell.js';

/**
 * `node:sqlite` only exists under the `node:`-prefixed form — unlike
 * older builtins (`fs`, `path`, ...), Node does not also register a
 * bare `sqlite` module for it. A static `import { DatabaseSync } from
 * 'node:sqlite'` compiles and runs correctly under plain `tsc`/`node`,
 * but Vite 5's transform (which Vitest uses for `.ts` test files)
 * rewrites that specifier down to the bare `sqlite` form before
 * resolving it, and then fails to find an npm package by that name —
 * a real, confirmed Vitest/Vite compatibility gap for this specific,
 * newer builtin, not a hypothetical one: proven by first trying the
 * static import directly, watching it fail only under `vitest run`
 * (never under plain `tsc`/`node`), and trying several `vitest.config.ts`
 * externalization options before finding this is the actual fix.
 * `createRequire` sidesteps it entirely: a `require()` call is an
 * ordinary runtime function call from a bundler's perspective, never a
 * static specifier a transform would rewrite.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export interface CommittedRow<TCtx, TEffect> {
  readonly context: TCtx;
  readonly effects: readonly TEffect[];
}

/**
 * A real, ACID-compliant SQL-backed `ImperativeShell` — the production
 * counterpart `createFileShell`'s own doc comment names as "a real
 * deployment needs to layer these on separately." Built against Node's
 * *built-in* `node:sqlite` module specifically: a real database, zero
 * new npm dependency, no native-module build step — see
 * docs/HYBRID_ARCHITECTURE_ALIGNMENT.md's "when a real database is
 * wired in" note, and the deliberate choice recorded where this was
 * decided.
 *
 * Same append-only, JSON-blob-per-row discipline `createFileShell`
 * already uses (`commits`/`audit_log` tables, one `payload` column
 * each), backed by real SQL tables instead of JSON Lines files —
 * `commit`/`recordAudit` don't get real per-field columns, because
 * `TCtx`/`TEffect`/`TAuditRecord` are generic and this shell (like the
 * file-backed one) has no domain-specific schema to normalize into.
 * Swapping this in for `createFileShell` needs zero changes to
 * `act()`, `actHuman()`, or anything upstream — they were built against
 * the `ImperativeShell` interface from the start, exactly so this swap
 * could be a new file, not a rewrite.
 *
 * **What this genuinely buys over `createFileShell`:** real
 * transactional writes, and (SQLite's own guarantee, not something
 * added here) safe concurrent readers while a single writer writes —
 * closing the file-backed shell's own documented "no concurrent-writer
 * safety beyond a single process appending" gap for the read side, not
 * the write side.
 *
 * **What this still does *not* provide, on purpose, same honesty
 * `createFileShell`'s own doc comment already holds itself to:**
 * - No retention/rotation policy — still a records-management decision,
 *   not something a table schema encodes.
 * - No backup, replication, or encryption at rest — whatever filesystem
 *   `databasePath` sits on needs those handled independently, same as
 *   the file-backed shell.
 * - No multi-process, multi-host *write* scaling. A single SQLite file
 *   is not a distributed database; if true horizontal write scale
 *   across multiple application servers is ever a real need, a
 *   client-server database (e.g. PostgreSQL) is the next step, not a
 *   configuration change to this file.
 * - No corruption recovery: a row whose `payload` fails to `JSON.parse`
 *   on read throws rather than being silently skipped — the same
 *   "losing a record silently is a worse failure than a loud crash"
 *   reasoning `createFileShell` already applies.
 *
 * **A real difference from `createFileShell` callers need to know, not
 * just a test-cleanup detail:** this shell holds an open OS-level file
 * handle to `databasePath` for as long as it's alive — `createFileShell`
 * never does, since `appendFileSync`/`readFileSync` open and close a
 * handle per call. Call the returned `close()` when done with a shell
 * instance. Found empirically, not anticipated: an early version of
 * this file's own test suite left one instance unclosed, and the
 * *next* thing that tried to delete its temp directory failed with an
 * OS-level permission error (Windows refuses to remove a directory
 * containing an open file) — proof the handle was genuinely still
 * open, not just a theoretical concern.
 */
export function createSqliteShell<
  TCtx,
  TInstruction extends Kinded,
  TEffect,
  TAuditRecord = AuditRecord<TInstruction, TEffect>,
>(databasePath: string): ImperativeShell<TCtx, TInstruction, TEffect, TAuditRecord> & { close(): void } {
  const db = new DatabaseSync(databasePath);

  db.exec('CREATE TABLE IF NOT EXISTS commits (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)');

  const insertCommit = db.prepare('INSERT INTO commits (payload) VALUES (?)');
  const insertAudit = db.prepare('INSERT INTO audit_log (payload) VALUES (?)');
  const latestCommit = db.prepare('SELECT payload FROM commits ORDER BY id DESC LIMIT 1');

  return {
    commit(context, effects) {
      insertCommit.run(JSON.stringify({ context, effects }));
    },
    recordAudit(record) {
      insertAudit.run(JSON.stringify(record));
    },
    readLatest() {
      const row = latestCommit.get();
      if (!row) {
        return undefined;
      }
      const parsed = JSON.parse(row['payload'] as string) as CommittedRow<TCtx, TEffect>;
      return parsed.context;
    },
    close() {
      db.close();
    },
  };
}

/** Reads every committed `{context, effects}` row, oldest first — the
 * SQLite-backed counterpart to `fileShell.ts`'s `readCommits`. Opens
 * and closes its own short-lived, read-only connection rather than
 * sharing the writer's handle, keeping this stateless the same way
 * `readCommits(file)` is: a path in, data out, no connection lifecycle
 * for the caller to manage. */
export function readSqliteCommits<TCtx, TEffect>(databasePath: string): readonly CommittedRow<TCtx, TEffect>[] {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return db
      .prepare('SELECT payload FROM commits ORDER BY id ASC')
      .all()
      .map((row) => JSON.parse(row['payload'] as string) as CommittedRow<TCtx, TEffect>);
  } finally {
    db.close();
  }
}

/** Reads every audit record, oldest first — the SQLite-backed
 * counterpart to `fileShell.ts`'s `readAuditLog`. `TAuditRecord`
 * defaults the same way `readAuditLog` does; pass
 * `HumanActionAuditRecord<TInstruction, TEffect>` explicitly to read
 * back a database written by the human-initiated path instead. */
export function readSqliteAuditLog<
  TInstruction extends Kinded,
  TEffect,
  TAuditRecord = AuditRecord<TInstruction, TEffect>,
>(databasePath: string): readonly TAuditRecord[] {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return db
      .prepare('SELECT payload FROM audit_log ORDER BY id ASC')
      .all()
      .map((row) => JSON.parse(row['payload'] as string) as TAuditRecord);
  } finally {
    db.close();
  }
}
