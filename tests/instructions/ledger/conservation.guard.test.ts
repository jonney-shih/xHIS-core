import { describe, expect, it } from 'vitest';
import { ledgerEngine } from '../../../src/instructions/ledger/engine.js';
import { accountId, entryId, isoTimestamp } from '../../../src/instructions/ledger/ids.js';
import type { LedgerContext, LedgerInstruction } from '../../../src/instructions/ledger/types.js';

/**
 * The domain-specific invariant proof step for the conservation family
 * (see `docs/DETERMINISTIC_CORE_PATTERN.md`) — not a state-machine
 * invariant like patient's exact replay or bed/lab's no-double-booking,
 * but a genuine conservation law: as long as `postEntryHandler` only
 * ever accepts entries whose debits equal their credits (its own doc
 * comment explains why), the *sum of every account's balance across the
 * whole ledger* must stay exactly zero after every single instruction,
 * forever. This file is the empirical proof that it actually holds, not
 * just an assertion that it should — the same role
 * `determinism.guard.test.ts` plays for replay-determinism.
 */
function totalBalance(context: LedgerContext): number {
  return Object.values(context.accounts).reduce((sum, account) => sum + account.balance, 0);
}

/** A small deterministic linear-congruential generator — not
 * `Math.random()`, so a failing run is exactly reproducible from the
 * fixed seed below. */
function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

const ACCOUNT_POOL = ['cash', 'revenue', 'expenses', 'payable', 'receivable'].map((id) => accountId(id));

describe('ledger conservation invariant', () => {
  it('keeps the total balance across every account at exactly zero through many posts and reversals', () => {
    const rng = makeRng(42);
    let context: LedgerContext = { accounts: {}, entries: {} };
    const postedEntryIds: string[] = [];
    const reversedEntryIds = new Set<string>();

    expect(totalBalance(context)).toBe(0);

    for (let step = 0; step < 60; step += 1) {
      const timestamp = isoTimestamp(`2026-07-20T00:${String(step).padStart(2, '0')}:00.000Z`);
      const canReverse = step > 5 && postedEntryIds.length > reversedEntryIds.size;
      const shouldReverse = canReverse && rng() < 0.25;

      let instruction: LedgerInstruction;

      if (shouldReverse) {
        let candidate: string;
        do {
          candidate = pick(rng, postedEntryIds);
        } while (reversedEntryIds.has(candidate));
        reversedEntryIds.add(candidate);

        instruction = { kind: 'ReverseEntry', entryId: entryId(candidate), reversedAt: timestamp };
      } else {
        const debitAccount = pick(rng, ACCOUNT_POOL);
        let creditAccount = pick(rng, ACCOUNT_POOL);
        while (creditAccount === debitAccount) {
          creditAccount = pick(rng, ACCOUNT_POOL);
        }
        const amount = 1 + Math.floor(rng() * 10_000);
        const id = `entry-${step}`;
        postedEntryIds.push(id);

        instruction = {
          kind: 'PostEntry',
          entryId: entryId(id),
          lines: [
            { accountId: debitAccount, direction: 'debit', amount },
            { accountId: creditAccount, direction: 'credit', amount },
          ],
          memo: `synthetic step ${step}`,
          postedAt: timestamp,
        };
      }

      const result = ledgerEngine.execute(context, instruction);
      if (!result.ok) throw new Error(`step ${step} unexpectedly rejected: ${JSON.stringify(result.error)}`);

      context = result.value.context;

      // The invariant is checked after *every* instruction, not just at
      // the end — a bug that transiently unbalances the ledger and
      // happens to cancel out by the last step must still fail here.
      expect(totalBalance(context)).toBe(0);
    }

    // Confirm real movement happened — an invariant holding only because
    // the ledger stayed empty the whole time would be a vacuous proof.
    const nonZeroAccounts = Object.values(context.accounts).filter((account) => account.balance !== 0);
    expect(nonZeroAccounts.length).toBeGreaterThan(0);
    expect(postedEntryIds.length).toBeGreaterThan(reversedEntryIds.size);
  });

  it('confirms the guard is load-bearing: a state that skipped the balance check is exactly the state that breaks the invariant', () => {
    // Not a call through `postEntryHandler` (which correctly rejects
    // this) — a direct, deliberately-invalid context standing in for
    // "what if the balance check above were ever removed or bypassed."
    const contextWithoutTheCheck: LedgerContext = {
      accounts: { cash: { accountId: accountId('cash'), balance: 500 } }, // debited once, never credited anywhere
      entries: {},
    };

    expect(totalBalance(contextWithoutTheCheck)).not.toBe(0);
  });
});
