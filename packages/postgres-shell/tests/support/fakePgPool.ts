/**
 * A hand-rolled, in-memory stand-in for a real `pg.Pool`, implementing
 * just enough of its behavior (`connect()`, a client's `query()`/
 * `release()`, transaction semantics, and the one constraint violation
 * `postgresShell.ts` depends on) to let these tests prove the *shell's*
 * logic — version bookkeeping, conflict-to-error translation, tenant
 * scoping, transaction commit/rollback — without a real database.
 *
 * What this deliberately does *not* prove, because nothing short of a
 * real Postgres can: that `schema.ts`'s row-level-security policies
 * actually block a cross-tenant read, that `FORCE ROW LEVEL SECURITY`
 * actually binds the table owner, or that a real concurrent two-
 * connection race resolves the way the single-threaded JS event loop
 * forces it to resolve here. See `postgresShellIntegration.test.ts` for
 * the env-gated suite that exercises those against a real database when
 * one is available, and this package's README for why that suite is
 * skipped by default in this environment.
 */

interface CommitRow {
  readonly tenant_id: string;
  readonly version: bigint;
  readonly context: unknown;
  readonly effects: unknown;
}

interface AuditRow {
  readonly tenant_id: string;
  readonly seq: number;
  readonly record: unknown;
}

export class FakeUniqueViolationError extends Error {
  readonly code = '23505';
  constructor(message: string) {
    super(message);
    this.name = 'FakeUniqueViolationError';
  }
}

export interface QueryLogEntry {
  readonly text: string;
  readonly params: readonly unknown[];
}

export interface FakePgPool {
  readonly pool: {
    connect(): Promise<FakePgClient>;
    query(text: string, params?: readonly unknown[]): Promise<{ rows: unknown[] }>;
  };
  readonly commits: readonly CommitRow[];
  readonly auditRows: readonly AuditRow[];
  readonly queryLog: readonly QueryLogEntry[];
}

interface FakePgClient {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: unknown[] }>;
  release(): void;
}

export function createFakePgPool(): FakePgPool {
  const commits: CommitRow[] = [];
  const auditRows: AuditRow[] = [];
  const queryLog: QueryLogEntry[] = [];
  let auditSeq = 0;

  function makeClient(): FakePgClient {
    let pendingCommits: CommitRow[] = [];
    let pendingAudit: AuditRow[] = [];

    function visibleCommits(): readonly CommitRow[] {
      return [...commits, ...pendingCommits];
    }
    function visibleAudit(): readonly AuditRow[] {
      return [...auditRows, ...pendingAudit];
    }

    return {
      async query(text, params = []) {
        queryLog.push({ text, params });
        const sql = text.trim();

        if (sql === 'BEGIN') {
          pendingCommits = [];
          pendingAudit = [];
          return { rows: [] };
        }
        if (sql === 'COMMIT') {
          commits.push(...pendingCommits);
          auditRows.push(...pendingAudit);
          pendingCommits = [];
          pendingAudit = [];
          return { rows: [] };
        }
        if (sql === 'ROLLBACK') {
          pendingCommits = [];
          pendingAudit = [];
          return { rows: [] };
        }
        if (sql.startsWith("SELECT set_config(")) {
          return { rows: [{ set_config: params[0] }] };
        }
        if (sql.includes('CREATE TABLE IF NOT EXISTS xhis_shell_commits')) {
          return { rows: [] };
        }
        if (sql.startsWith('SELECT version, context FROM xhis_shell_commits')) {
          const tenantId = params[0] as string;
          const rows = visibleCommits()
            .filter((row) => row.tenant_id === tenantId)
            .sort((a, b) => (a.version > b.version ? -1 : 1));
          return rows.length === 0
            ? { rows: [] }
            : { rows: [{ version: rows[0]!.version.toString(), context: rows[0]!.context }] };
        }
        if (sql.startsWith('SELECT MAX(version)')) {
          const tenantId = params[0] as string;
          const rows = visibleCommits().filter((row) => row.tenant_id === tenantId);
          const max = rows.reduce((acc, row) => (row.version > acc ? row.version : acc), 0n);
          return { rows: [{ max_version: rows.length === 0 ? null : max.toString() }] };
        }
        if (sql.startsWith('INSERT INTO xhis_shell_commits')) {
          const [tenantId, versionStr, contextJson, effectsJson] = params as [string, string, string, string];
          const version = BigInt(versionStr);
          const conflict = visibleCommits().some((row) => row.tenant_id === tenantId && row.version === version);
          if (conflict) {
            throw new FakeUniqueViolationError(
              `duplicate key value violates unique constraint "xhis_shell_commits_pkey" (tenant_id, version)=(${tenantId}, ${version})`,
            );
          }
          pendingCommits.push({
            tenant_id: tenantId,
            version,
            context: JSON.parse(contextJson) as unknown,
            effects: JSON.parse(effectsJson) as unknown,
          });
          return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO xhis_shell_audit')) {
          const [tenantId, recordJson] = params as [string, string];
          auditSeq += 1;
          pendingAudit.push({ tenant_id: tenantId, seq: auditSeq, record: JSON.parse(recordJson) as unknown });
          return { rows: [] };
        }

        throw new Error(`createFakePgPool: unrecognized query text: ${sql}`);
      },
      release() {
        // Nothing to return to a real connection pool.
      },
    };
  }

  return {
    pool: {
      connect: () => Promise.resolve(makeClient()),
      query: (text, params = []) => makeClient().query(text, params),
    },
    commits,
    auditRows,
    queryLog,
  };
}
