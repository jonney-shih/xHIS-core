import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { withTenantConnection } from '../src/tenantTransaction.js';
import { createFakePgPool } from './support/fakePgPool.js';

describe('withTenantConnection', () => {
  it('scopes app.tenant_id before running fn, and commits fn\'s writes', async () => {
    const { pool, queryLog } = createFakePgPool();

    const result = await withTenantConnection(pool as unknown as Pool, 'hospital-a', async (client) => {
      await client.query('INSERT INTO xhis_shell_audit (tenant_id, record) VALUES ($1, $2::jsonb)', [
        'hospital-a',
        JSON.stringify({ ok: true }),
      ]);
      return 'done';
    });

    expect(result).toBe('done');
    const texts = queryLog.map((entry) => entry.text);
    expect(texts[0]).toBe('BEGIN');
    expect(texts[1]).toMatch(/^SELECT set_config\(/);
    expect(queryLog[1]!.params[0]).toBe('hospital-a');
    expect(texts.at(-1)).toBe('COMMIT');
    expect(texts).not.toContain('ROLLBACK');
  });

  it('rolls back and rethrows when fn throws, leaving no partial writes behind', async () => {
    const { pool, queryLog, auditRows } = createFakePgPool();

    await expect(
      withTenantConnection(pool as unknown as Pool, 'hospital-a', async (client) => {
        await client.query('INSERT INTO xhis_shell_audit (tenant_id, record) VALUES ($1, $2::jsonb)', [
          'hospital-a',
          JSON.stringify({ ok: true }),
        ]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(auditRows).toHaveLength(0);
    expect(queryLog.map((entry) => entry.text)).toContain('ROLLBACK');
    expect(queryLog.map((entry) => entry.text)).not.toContain('COMMIT');
  });

  it('scopes the tenant to one transaction, not the whole connection -- a second call with a different tenant is independently scoped', async () => {
    const { pool, queryLog } = createFakePgPool();

    await withTenantConnection(pool as unknown as Pool, 'hospital-a', async () => undefined);
    await withTenantConnection(pool as unknown as Pool, 'hospital-b', async () => undefined);

    const setConfigCalls = queryLog.filter((entry) => entry.text.startsWith('SELECT set_config('));
    expect(setConfigCalls.map((entry) => entry.params[0])).toEqual(['hospital-a', 'hospital-b']);
  });
});
