import type { AccountId } from '../ids.js';
import type { AccountRecord, LedgerLine } from '../types.js';

/**
 * Applies every line to the account map, auto-vivifying any account not
 * yet present at balance `0`. `sign` is `1` for posting (debit adds,
 * credit subtracts) and `-1` for reversing (the exact inverse) — sharing
 * this one function between `postEntry.ts` and `reverseEntry.ts` is what
 * guarantees a reversal is *exactly* the negation of a post, not a
 * separately-maintained mirror that could drift out of sync with it.
 */
export function applyLines(
  accounts: Readonly<Record<string, AccountRecord>>,
  lines: readonly LedgerLine[],
  sign: 1 | -1,
): Readonly<Record<string, AccountRecord>> {
  const next: Record<string, AccountRecord> = { ...accounts };

  for (const line of lines) {
    const key: AccountId = line.accountId;
    const existing = next[key] ?? { accountId: line.accountId, balance: 0 };
    const delta = sign * (line.direction === 'debit' ? line.amount : -line.amount);

    next[key] = { accountId: line.accountId, balance: existing.balance + delta };
  }

  return next;
}
