import type { Pool, PoolClient } from 'pg';

/**
 * Checks out one client from `pool`, scopes it to `tenantId` for exactly
 * one transaction, runs `fn`, and commits or rolls back accordingly.
 *
 * The scoping step is `SELECT set_config('app.tenant_id', $1, true)`, not
 * a literal `SET LOCAL app.tenant_id = $1` — Postgres's `SET` statement
 * does not accept a bound parameter in that position at all (it wants a
 * literal), and building that string by interpolating `tenantId` directly
 * would be a SQL-injection hole for the one piece of this whole shell
 * that is supposed to be the tenant-isolation boundary. `set_config`'s
 * third argument (`is_local = true`) gives the identical "only for this
 * transaction" scoping `SET LOCAL` would, through an ordinary
 * parameterized function call instead.
 *
 * That scoping *must* be transaction-local, and this function exists
 * specifically to make that unskippable: `pool.query(...)` hands back a
 * connection to the pool after every call, so a session-level `SET`
 * (`is_local = false`, or no transaction at all) would leak whichever
 * tenant last used that pooled connection into the *next* caller's
 * queries on it — a real cross-tenant data leak, not a hypothetical one,
 * for exactly the reason connection pooling exists (reusing connections
 * across callers). Checking out a single client for `BEGIN` ...
 * `set_config` ... `fn` ... `COMMIT`/`ROLLBACK` keeps the setting scoped
 * to this one transaction no matter which pooled connection `pool.connect()`
 * happens to hand back.
 *
 * This is also what makes `xhis_shell_commits`'/`xhis_shell_audit`'s RLS
 * policies (see `schema.ts`) actually bind: without `app.tenant_id` set,
 * `current_setting('app.tenant_id', true)` is `NULL`, and a policy
 * comparing a real `tenant_id` against `NULL` is never true — every query
 * run through this helper is what supplies the value those policies
 * check against.
 */
export async function withTenantConnection<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {
      // The connection may already be unusable (e.g. the error that got us
      // here was itself a broken-connection error) -- losing the original
      // error to a failed cleanup rollback would hide the real cause.
    });
    throw error;
  } finally {
    client.release();
  }
}
