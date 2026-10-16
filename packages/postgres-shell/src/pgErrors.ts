/** Postgres's SQLSTATE for a unique-constraint violation — stable across
 * versions, part of the standard SQLSTATE error-code table, not specific
 * to this schema. `pg` surfaces it as `.code` on the thrown error. */
const UNIQUE_VIOLATION_SQLSTATE = '23505';

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION_SQLSTATE
  );
}
