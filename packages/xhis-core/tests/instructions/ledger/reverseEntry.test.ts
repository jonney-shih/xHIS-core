import { describe, expect, it } from 'vitest';
import { reverseEntryHandler } from '../../../src/instructions/ledger/handlers/reverseEntry.js';
import { accountId, entryId, isoTimestamp } from '../../../src/instructions/ledger/ids.js';
import type { LedgerContext } from '../../../src/instructions/ledger/types.js';

const postedLines = [
  { accountId: accountId('cash'), direction: 'debit' as const, amount: 500 },
  { accountId: accountId('revenue'), direction: 'credit' as const, amount: 500 },
];

const contextWithPostedEntry: LedgerContext = {
  accounts: {
    cash: { accountId: accountId('cash'), balance: 500 },
    revenue: { accountId: accountId('revenue'), balance: -500 },
  },
  entries: {
    'entry-1': {
      entryId: entryId('entry-1'),
      lines: postedLines,
      memo: 'invoice #1',
      status: 'posted',
      postedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
    },
  },
};

describe('reverseEntryHandler', () => {
  it('reverses a posted entry, restoring both account balances to exactly where they started', () => {
    const result = reverseEntryHandler(contextWithPostedEntry, {
      kind: 'ReverseEntry',
      entryId: entryId('entry-1'),
      reversedAt: isoTimestamp('2026-07-20T01:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.accounts['cash']).toEqual({ accountId: 'cash', balance: 0 });
    expect(result.value.context.accounts['revenue']).toEqual({ accountId: 'revenue', balance: 0 });
    expect(result.value.context.entries['entry-1']).toEqual({
      entryId: 'entry-1',
      lines: postedLines,
      memo: 'invoice #1',
      status: 'reversed',
      postedAt: '2026-07-20T00:00:00.000Z',
      reversedAt: '2026-07-20T01:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'EntryReversed', entryId: 'entry-1', reversedAt: '2026-07-20T01:00:00.000Z' },
    ]);
  });

  it('rejects reversing an entry that does not exist', () => {
    const result = reverseEntryHandler(
      { accounts: {}, entries: {} },
      { kind: 'ReverseEntry', entryId: entryId('entry-1'), reversedAt: isoTimestamp('2026-07-20T01:00:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'EntryNotFound', entryId: 'entry-1' } });
  });

  it('rejects reversing an entry that has already been reversed', () => {
    const alreadyReversed: LedgerContext = {
      accounts: { cash: { accountId: accountId('cash'), balance: 0 }, revenue: { accountId: accountId('revenue'), balance: 0 } },
      entries: {
        'entry-1': {
          entryId: entryId('entry-1'),
          lines: postedLines,
          memo: 'invoice #1',
          status: 'reversed',
          postedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
          reversedAt: isoTimestamp('2026-07-20T01:00:00.000Z'),
        },
      },
    };

    const result = reverseEntryHandler(alreadyReversed, {
      kind: 'ReverseEntry',
      entryId: entryId('entry-1'),
      reversedAt: isoTimestamp('2026-07-20T02:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'EntryAlreadyReversed', entryId: 'entry-1' } });
  });
});
