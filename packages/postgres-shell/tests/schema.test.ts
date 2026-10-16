import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { ensureSchema, POSTGRES_SHELL_SCHEMA_SQL } from '../src/schema.js';
import { createFakePgPool } from './support/fakePgPool.js';

describe('ensureSchema', () => {
  it('issues the schema SQL against the pool', async () => {
    const { pool, queryLog } = createFakePgPool();
    await ensureSchema(pool as unknown as Pool);

    expect(queryLog).toHaveLength(1);
    expect(queryLog[0]!.text).toBe(POSTGRES_SHELL_SCHEMA_SQL);
  });
});

describe('POSTGRES_SHELL_SCHEMA_SQL', () => {
  it('creates both tables idempotently', () => {
    expect(POSTGRES_SHELL_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS xhis_shell_commits');
    expect(POSTGRES_SHELL_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS xhis_shell_audit');
  });

  it('makes (tenant_id, version) the primary key -- the actual optimistic-concurrency mechanism', () => {
    expect(POSTGRES_SHELL_SCHEMA_SQL).toContain('PRIMARY KEY (tenant_id, version)');
  });

  it('enables and forces row-level security on both tables, not just one of the two', () => {
    for (const table of ['xhis_shell_commits', 'xhis_shell_audit']) {
      expect(POSTGRES_SHELL_SCHEMA_SQL).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(POSTGRES_SHELL_SCHEMA_SQL).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
  });

  it('defines a tenant-isolation policy on both tables, drop-first for idempotency', () => {
    for (const table of ['xhis_shell_commits', 'xhis_shell_audit']) {
      expect(POSTGRES_SHELL_SCHEMA_SQL).toContain(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${table}`);
      expect(POSTGRES_SHELL_SCHEMA_SQL).toContain(`CREATE POLICY ${table}_tenant_isolation ON ${table}`);
    }
    expect(POSTGRES_SHELL_SCHEMA_SQL).toContain("current_setting('app.tenant_id', true)");
  });
});
