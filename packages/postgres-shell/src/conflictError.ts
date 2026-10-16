/**
 * Thrown by `createPostgresShell`'s `commit()` when another writer has
 * already committed the version this call was about to write — the real
 * multi-writer race `docs/DETERMINISTIC_CORE_PATTERN.md`'s "Resolved:
 * ImperativeShell and act() become async-capable" flagged as still open:
 * `act()`'s own `readLatest()` -> `reexecute` -> `commit()` sequence is
 * three separate calls, and nothing between them stops a second writer
 * from committing in between once `shell` is backed by a real, separate
 * database process rather than this same in-process call stack.
 *
 * `xhis_shell_commits`'s `PRIMARY KEY (tenant_id, version)` is what
 * actually catches this — atomically, at the database, the only place
 * that can see every concurrent writer at once — and this error is this
 * shell's translation of that constraint violation into something a
 * caller can catch and react to. `act()` itself has no special handling
 * for it and needs none: it already `await`s `shell.commit(...)` directly
 * inside `finalize`, so this simply propagates out of `act()` as a
 * rejected `Promise`, same as any other unexpected shell failure.
 *
 * Throwing here, rather than inventing a new `CommitOutcome` value,
 * matches the existing "a shell refuses by throwing" precedent
 * `@xhis/xguard`'s `createShadowOpsShell`/`createFileShadowOpsShell`
 * already established for a harness-contract violation.
 *
 * The one safe recovery: re-derive a fresh proposal against current
 * state (a new `readLatest()`, a new `reexecute`/Do) and call `act()`
 * again. Retrying with the *same* already-computed proposal unchanged is
 * not safe — it was computed against a baseline this error just proved
 * is no longer current.
 */
export class PostgresShellConflictError extends Error {
  readonly tenantId: string;
  readonly attemptedVersion: bigint;

  constructor(tenantId: string, attemptedVersion: bigint) {
    super(
      `createPostgresShell: commit conflict for tenant '${tenantId}' at version ${attemptedVersion} -- another writer already committed this version; re-derive against current state and retry, do not resubmit the same proposal unchanged`,
    );
    this.name = 'PostgresShellConflictError';
    this.tenantId = tenantId;
    this.attemptedVersion = attemptedVersion;
  }
}
