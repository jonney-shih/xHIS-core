/**
 * `@xhis/postgres-shell`: a real, multi-writer-safe `ImperativeShell`
 * backed by a shared Postgres cluster — see `postgresShell.ts` for the
 * concurrency/tenancy design, `schema.ts` for the tables and row-level-
 * security policies it needs, and `conflictError.ts` for what a caller
 * gets when another writer wins a race.
 *
 * Built only on `@xhis/core`'s public export surface, the same
 * constraint `@xhis/xguard` already follows — `@xhis/core` itself stays
 * at zero runtime dependencies; `pg` lives only here.
 */
export { createPostgresShell } from './postgresShell.js';
export { ensureSchema, POSTGRES_SHELL_SCHEMA_SQL } from './schema.js';
export { PostgresShellConflictError } from './conflictError.js';
