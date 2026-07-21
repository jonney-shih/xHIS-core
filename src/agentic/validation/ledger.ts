import { err, ok, type Result } from '../../core/execution/result.js';
import { accountId, entryId, isoTimestamp } from '../../instructions/ledger/ids.js';
import type { LedgerInstruction, LedgerLine } from '../../instructions/ledger/types.js';
import { isIsoTimestamp, isNonEmptyString } from './guards.js';
import type { InstructionValidatorRegistry } from './validator.js';

type PostEntry = Extract<LedgerInstruction, { kind: 'PostEntry' }>;
type ReverseEntry = Extract<LedgerInstruction, { kind: 'ReverseEntry' }>;

/**
 * `lines` is the first array-valued field any domain's validators have
 * had to shape-check. This checks the same level of thing every other
 * field check here does — is it the right *shape* — not the domain's
 * own conservation invariant (debits equal credits): that's
 * `postEntryHandler`'s job at Do-time, the same division of labor
 * `EntryAlreadyExists`/`BedAlreadyOccupied` already establish between
 * validator and handler.
 */
function isValidLineShape(candidate: unknown): candidate is { accountId: string; direction: 'debit' | 'credit'; amount: number } {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const line = candidate as Record<string, unknown>;
  return (
    isNonEmptyString(line['accountId']) &&
    (line['direction'] === 'debit' || line['direction'] === 'credit') &&
    typeof line['amount'] === 'number' &&
    Number.isInteger(line['amount'])
  );
}

export function validatePostEntry(candidate: unknown): Result<PostEntry, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['entryId'])) issues.push("'entryId' must be a non-empty string");

  const rawLines = c['lines'];
  const linesAreValid = Array.isArray(rawLines) && rawLines.length > 0 && rawLines.every(isValidLineShape);
  if (!linesAreValid) {
    issues.push("'lines' must be a non-empty array of { accountId: non-empty string, direction: 'debit' | 'credit', amount: integer }");
  }

  if (!isNonEmptyString(c['memo'])) issues.push("'memo' must be a non-empty string");
  if (!isIsoTimestamp(c['postedAt'])) issues.push("'postedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  const lines: readonly LedgerLine[] = (rawLines as ReadonlyArray<{ accountId: string; direction: 'debit' | 'credit'; amount: number }>).map(
    (line) => ({
      accountId: accountId(line.accountId),
      direction: line.direction,
      amount: line.amount,
    }),
  );

  return ok({
    kind: 'PostEntry',
    entryId: entryId(c['entryId'] as string),
    lines,
    memo: c['memo'] as string,
    postedAt: isoTimestamp(c['postedAt'] as string),
  });
}

function validateReverseEntry(candidate: unknown): Result<ReverseEntry, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['entryId'])) issues.push("'entryId' must be a non-empty string");
  if (!isIsoTimestamp(c['reversedAt'])) issues.push("'reversedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'ReverseEntry',
    entryId: entryId(c['entryId'] as string),
    reversedAt: isoTimestamp(c['reversedAt'] as string),
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` — see
 * __typetests__/ledger.exhaustiveness.ts for the compile-time proof that
 * this is total over `LedgerInstruction`.
 */
export const ledgerInstructionValidators = {
  PostEntry: validatePostEntry,
  ReverseEntry: validateReverseEntry,
} satisfies InstructionValidatorRegistry<LedgerInstruction>;
