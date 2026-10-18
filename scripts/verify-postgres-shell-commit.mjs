#!/usr/bin/env node
// A small, standalone read-back for a single tenant's rows in
// xhis_shell_commits/xhis_shell_audit -- for manually confirming that
// a commit roleplay-cli.mjs reported (it prints the exact tenant it
// used right after "committed to the Postgres cluster under tenant
// '...'") actually landed on a real cluster.
//
// Deliberately goes through the real tenant-scoping dance
// (withTenantConnection's same BEGIN/set_config/COMMIT), not a bare
// SELECT * -- xhis_shell_commits/xhis_shell_audit have
// FORCE ROW LEVEL SECURITY (see @xhis/postgres-shell's schema.ts), so a
// query that never sets app.tenant_id sees nothing for a non-superuser
// role, and sees *every* tenant's rows for a superuser one. Scoping
// correctly here is what makes this read-back trustworthy regardless
// of which kind of role XHIS_POSTGRES_URL connects as.
//
// Run with: node scripts/verify-postgres-shell-commit.mjs <tenantId>
// (requires XHIS_POSTGRES_URL to already be set in this shell)

import { Pool } from 'pg';

const tenantId = process.argv[2];
const connectionString = process.env.XHIS_POSTGRES_URL;

if (!tenantId) {
  console.error('Usage: node scripts/verify-postgres-shell-commit.mjs <tenantId>');
  process.exitCode = 1;
} else if (!connectionString) {
  console.error('XHIS_POSTGRES_URL is not set in this shell.');
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      const commits = await client.query(
        'SELECT version, context, effects, committed_at FROM xhis_shell_commits WHERE tenant_id = $1 ORDER BY version',
        [tenantId],
      );
      const audit = await client.query(
        'SELECT seq, record, recorded_at FROM xhis_shell_audit WHERE tenant_id = $1 ORDER BY seq',
        [tenantId],
      );

      await client.query('COMMIT');

      console.log(`Tenant '${tenantId}':`);
      console.log(`\n${commits.rows.length} row(s) in xhis_shell_commits:`);
      for (const row of commits.rows) {
        console.log(`  version ${row.version} @ ${row.committed_at.toISOString()}`);
        console.log(`    context: ${JSON.stringify(row.context)}`);
        console.log(`    effects: ${JSON.stringify(row.effects)}`);
      }
      console.log(`\n${audit.rows.length} row(s) in xhis_shell_audit:`);
      for (const row of audit.rows) {
        console.log(`  seq ${row.seq} @ ${row.recorded_at.toISOString()}: ${JSON.stringify(row.record)}`);
      }

      if (commits.rows.length === 0 && audit.rows.length === 0) {
        console.log(
          "\nNothing found for this tenant. Either the tenant id doesn't match exactly, or this connection's role " +
            'cannot see it under row-level security (only a superuser bypasses RLS regardless of app.tenant_id).',
        );
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Query failed:', error.message ?? error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
