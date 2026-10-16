import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createPostgresShell } from '../src/postgresShell.js';
import { PostgresShellConflictError } from '../src/conflictError.js';
import { ensureSchema } from '../src/schema.js';

/**
 * Exercises `createPostgresShell` against a *real* Postgres instance --
 * the one thing `postgresShell.test.ts`'s hand-rolled fake pool cannot
 * prove: that `schema.ts`'s row-level-security policies actually bind
 * (including `FORCE ROW LEVEL SECURITY` against the connecting role),
 * and that the `PRIMARY KEY (tenant_id, version)` conflict genuinely
 * resolves under two real, independent connections racing -- not just
 * under this fake's necessarily single-threaded JS semantics.
 *
 * Gated on `XHIS_POSTGRES_TEST_URL` because no Postgres instance was
 * available in the environment this package was built in -- this suite
 * has not actually been run against a real database as part of building
 * it. Point it at a disposable database (e.g.
 * `postgres://postgres:postgres@localhost:5432/xhis_postgres_shell_test`)
 * to run it for real; every table this creates is prefixed `xhis_shell_`
 * and safe to drop afterward. See
 * docs/DETERMINISTIC_CORE_PATTERN.md's "Resolved: a real, multi-writer-
 * safe ImperativeShell (@xhis/postgres-shell)" for what this still
 * doesn't prove as a result.
 */
const connectionString = process.env.XHIS_POSTGRES_TEST_URL;

describe.skipIf(!connectionString)('createPostgresShell against a real Postgres instance', () => {
  it('two real connections racing on the same tenant: one commits, the other gets a genuine conflict', async () => {
    const pool = new Pool({ connectionString });
    try {
      await ensureSchema(pool);
      const tenantId = `test-${randomUUID()}`;
      const shellA = createPostgresShell<{ count: number }, { kind: 'Noop' }, { kind: 'Noop' }>(pool, tenantId);
      const shellB = createPostgresShell<{ count: number }, { kind: 'Noop' }, { kind: 'Noop' }>(pool, tenantId);

      expect(await shellA.readLatest()).toBeUndefined();
      expect(await shellB.readLatest()).toBeUndefined();

      await shellA.commit({ count: 1 }, []);
      await expect(shellB.commit({ count: 99 }, [])).rejects.toThrow(PostgresShellConflictError);

      expect(await shellA.readLatest()).toEqual({ count: 1 });
    } finally {
      await pool.end();
    }
  });

  it('a query that never sets app.tenant_id sees no rows for a real tenant, under RLS', async () => {
    const pool = new Pool({ connectionString });
    try {
      await ensureSchema(pool);
      const tenantId = `test-${randomUUID()}`;
      const shell = createPostgresShell<{ count: number }, { kind: 'Noop' }, { kind: 'Noop' }>(pool, tenantId);
      await shell.readLatest();
      await shell.commit({ count: 1 }, []);

      // Bypasses this package entirely -- a raw query on the pool, with
      // app.tenant_id never set for this connection's session/transaction.
      const raw = await pool.query('SELECT * FROM xhis_shell_commits WHERE tenant_id = $1', [tenantId]);
      expect(raw.rows).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });
});
