import type { Pool, PoolClient } from 'pg';
import type { AuditRecord, ImperativeShell, Kinded } from '@xhis/core';
import { PostgresShellConflictError } from './conflictError.js';
import { isUniqueViolation } from './pgErrors.js';
import { withTenantConnection } from './tenantTransaction.js';

interface CommitRow<TCtx> {
  readonly version: string;
  readonly context: TCtx;
}

/**
 * A real, durable `ImperativeShell` backed by a shared Postgres cluster —
 * the thing `docs/DETERMINISTIC_CORE_PATTERN.md`'s "Resolved:
 * ImperativeShell and act() become async-capable" made *possible* but
 * deliberately did not build. One instance is constructed per hospital
 * (`createPostgresShell(pool, tenantId)`), against one shared `pool` —
 * tenancy is a construction-time concern, not something threaded through
 * every `commit`/`readLatest` call, so a caller can never accidentally
 * pass the wrong tenant into one specific call.
 *
 * Multi-writer safety (the entire reason this needs to be more than
 * `createFileShell` with a different storage backend): `commit()` tracks
 * the version it most recently saw via `readLatest()` on *this instance*
 * and tries to insert exactly the next one. `xhis_shell_commits`'s
 * `PRIMARY KEY (tenant_id, version)` (see `schema.ts`) makes a second
 * writer's conflicting attempt fail atomically at the database; this
 * shell translates that into a thrown `PostgresShellConflictError` (see
 * that file) rather than silently overwriting or guessing. Every real
 * call site in this codebase already calls `readLatest()` immediately
 * before `commit()` on the same shell instance (enforced for
 * `@xhis/core`'s own consumers by `eslint-rules/no-commit-without-fresh-
 * read.js`) — but `commit()` does not simply trust that happened: if this
 * instance has never called `readLatest()` (e.g. a shell used directly
 * in isolation, or restarted), it looks up the current version itself
 * first. Either way, the actual safety net is the database constraint,
 * not this instance's local bookkeeping — the bookkeeping only saves a
 * round trip in the common case.
 *
 * Tenant isolation beyond "every query here happens to filter by
 * `tenant_id`": every method runs inside `withTenantConnection`, which
 * sets Postgres's row-level-security context for exactly one transaction
 * — see that function's own doc comment for why it has to be scoped that
 * tightly under connection pooling, and `schema.ts` for the policies it
 * makes bind.
 */
export function createPostgresShell<
  TCtx,
  TInstruction extends Kinded,
  TEffect,
  TAuditRecord = AuditRecord<TInstruction, TEffect>,
>(pool: Pool, tenantId: string): ImperativeShell<TCtx, TInstruction, TEffect, TAuditRecord> {
  let lastReadVersion: bigint | undefined;

  return {
    async readLatest(): Promise<TCtx | undefined> {
      return withTenantConnection(pool, tenantId, async (client) => {
        const result = await client.query<CommitRow<TCtx>>(
          'SELECT version, context FROM xhis_shell_commits WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1',
          [tenantId],
        );
        if (result.rows.length === 0) {
          lastReadVersion = 0n;
          return undefined;
        }
        const row = result.rows[0]!;
        lastReadVersion = BigInt(row.version);
        return row.context;
      });
    },

    async commit(context: TCtx, effects: readonly TEffect[]): Promise<void> {
      await withTenantConnection(pool, tenantId, async (client) => {
        const baseVersion = lastReadVersion ?? (await currentMaxVersion(client, tenantId));
        const nextVersion = baseVersion + 1n;
        try {
          await client.query(
            'INSERT INTO xhis_shell_commits (tenant_id, version, context, effects) VALUES ($1, $2, $3::jsonb, $4::jsonb)',
            [tenantId, nextVersion.toString(), JSON.stringify(context), JSON.stringify(effects)],
          );
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new PostgresShellConflictError(tenantId, nextVersion);
          }
          throw error;
        }
        lastReadVersion = nextVersion;
      });
    },

    async recordAudit(record: TAuditRecord): Promise<void> {
      await withTenantConnection(pool, tenantId, async (client) => {
        await client.query('INSERT INTO xhis_shell_audit (tenant_id, record) VALUES ($1, $2::jsonb)', [
          tenantId,
          JSON.stringify(record),
        ]);
      });
    },
  };
}

async function currentMaxVersion(client: PoolClient, tenantId: string): Promise<bigint> {
  const result = await client.query<{ max_version: string | null }>(
    'SELECT MAX(version) AS max_version FROM xhis_shell_commits WHERE tenant_id = $1',
    [tenantId],
  );
  const raw = result.rows[0]?.max_version;
  return raw === null || raw === undefined ? 0n : BigInt(raw);
}
