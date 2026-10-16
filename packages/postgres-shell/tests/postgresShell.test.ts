import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createPostgresShell } from '../src/postgresShell.js';
import { PostgresShellConflictError } from '../src/conflictError.js';
import { createFakePgPool } from './support/fakePgPool.js';

interface TestContext {
  readonly count: number;
}
interface TestEffect {
  readonly kind: 'Incremented';
  readonly by: number;
}

function shellFor(pool: unknown, tenantId: string) {
  return createPostgresShell<TestContext, { kind: string }, TestEffect>(pool as Pool, tenantId);
}

describe('createPostgresShell', () => {
  it('readLatest() reports undefined when nothing has ever committed for this tenant', async () => {
    const { pool } = createFakePgPool();
    const shell = shellFor(pool, 'hospital-a');

    expect(await shell.readLatest()).toBeUndefined();
  });

  it('commit() then readLatest() on the same instance round-trips the context, and advances the version', async () => {
    const { pool, commits } = createFakePgPool();
    const shell = shellFor(pool, 'hospital-a');

    expect(await shell.readLatest()).toBeUndefined();
    await shell.commit({ count: 1 }, [{ kind: 'Incremented', by: 1 }]);

    expect(await shell.readLatest()).toEqual({ count: 1 });
    expect(commits).toEqual([{ tenant_id: 'hospital-a', version: 1n, context: { count: 1 }, effects: [{ kind: 'Incremented', by: 1 }] }]);

    await shell.commit({ count: 2 }, [{ kind: 'Incremented', by: 1 }]);
    expect(await shell.readLatest()).toEqual({ count: 2 });
    expect(commits.map((row) => row.version)).toEqual([1n, 2n]);
  });

  it('a second writer racing on the same version a first writer just took gets PostgresShellConflictError, not a silent overwrite', async () => {
    const { pool, commits } = createFakePgPool();
    const shellA = shellFor(pool, 'hospital-a');
    const shellB = shellFor(pool, 'hospital-a');

    // Both read the same starting point -- as if both computed a proposal
    // against the same snapshot before either had committed.
    expect(await shellA.readLatest()).toBeUndefined();
    expect(await shellB.readLatest()).toBeUndefined();

    await shellA.commit({ count: 1 }, []);

    await expect(shellB.commit({ count: 99 }, [])).rejects.toThrow(PostgresShellConflictError);

    // The loser's attempt left no trace: exactly one row, shellA's.
    expect(commits).toEqual([{ tenant_id: 'hospital-a', version: 1n, context: { count: 1 }, effects: [] }]);

    // The sanctioned recovery: re-read, then retry against what's actually there.
    expect(await shellB.readLatest()).toEqual({ count: 1 });
    await shellB.commit({ count: 2 }, []);
    expect(await shellB.readLatest()).toEqual({ count: 2 });
  });

  it('the thrown error reports the tenant and the version that lost the race', async () => {
    const { pool } = createFakePgPool();
    const shellA = shellFor(pool, 'hospital-a');
    const shellB = shellFor(pool, 'hospital-a');
    await shellA.readLatest();
    await shellB.readLatest();
    await shellA.commit({ count: 1 }, []);

    try {
      await shellB.commit({ count: 2 }, []);
      expect.unreachable('expected shellB.commit to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PostgresShellConflictError);
      expect((error as PostgresShellConflictError).tenantId).toBe('hospital-a');
      expect((error as PostgresShellConflictError).attemptedVersion).toBe(1n);
    }
  });

  it('commit() without a prior readLatest() on this instance still computes the correct next version, by asking the database', async () => {
    const { pool, commits } = createFakePgPool();
    const seeded = shellFor(pool, 'hospital-a');
    await seeded.readLatest();
    await seeded.commit({ count: 1 }, []);
    await seeded.commit({ count: 2 }, []);

    // A brand new instance, never asked to readLatest() first.
    const fresh = shellFor(pool, 'hospital-a');
    await fresh.commit({ count: 3 }, []);

    expect(commits.map((row) => row.version)).toEqual([1n, 2n, 3n]);
    expect(await fresh.readLatest()).toEqual({ count: 3 });
  });

  it('keeps each tenant\'s version sequence and committed state fully independent', async () => {
    const { pool, commits } = createFakePgPool();
    const hospitalA = shellFor(pool, 'hospital-a');
    const hospitalB = shellFor(pool, 'hospital-b');

    await hospitalA.readLatest();
    await hospitalB.readLatest();
    await hospitalA.commit({ count: 1 }, []);
    await hospitalB.commit({ count: 100 }, []);
    await hospitalA.commit({ count: 2 }, []);

    expect(await hospitalA.readLatest()).toEqual({ count: 2 });
    expect(await hospitalB.readLatest()).toEqual({ count: 100 });
    expect(commits.filter((row) => row.tenant_id === 'hospital-a').map((row) => row.version)).toEqual([1n, 2n]);
    expect(commits.filter((row) => row.tenant_id === 'hospital-b').map((row) => row.version)).toEqual([1n]);
  });

  it('recordAudit() appends records for this tenant without needing a prior readLatest()', async () => {
    const { pool, auditRows } = createFakePgPool();
    const shell = shellFor(pool, 'hospital-a');

    const record = { proposal: 'p1', decision: { kind: 'accept' }, commitOutcome: 'committed', reasons: [], effects: [], recordedAt: '2026-10-16T00:00:00.000Z' };
    await shell.recordAudit(record as never);

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.tenant_id).toBe('hospital-a');
    expect(auditRows[0]!.record).toEqual(record);
  });

  it('every query this shell issues is scoped to the tenant app.tenant_id was set to for that transaction', async () => {
    const { pool, queryLog } = createFakePgPool();
    const shell = shellFor(pool, 'hospital-a');
    await shell.readLatest();
    await shell.commit({ count: 1 }, []);

    const setConfigCalls = queryLog.filter((entry) => entry.text.startsWith("SELECT set_config("));
    expect(setConfigCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of setConfigCalls) {
      expect(call.params[0]).toBe('hospital-a');
    }
  });
});
