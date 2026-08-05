import { describe, expect, it } from 'vitest';
import { postEntryHandler } from '../../../src/instructions/ledger/handlers/postEntry.js';
import { accountId, entryId, isoTimestamp } from '../../../src/instructions/ledger/ids.js';
import type { LedgerContext } from '../../../src/instructions/ledger/types.js';

const emptyContext: LedgerContext = { accounts: {}, entries: {} };

const balancedLines = [
  { accountId: accountId('cash'), direction: 'debit' as const, amount: 500 },
  { accountId: accountId('revenue'), direction: 'credit' as const, amount: 500 },
];

describe('postEntryHandler', () => {
  it('posts a balanced entry, updates both account balances, and emits an EntryPosted effect', () => {
    const result = postEntryHandler(emptyContext, {
      kind: 'PostEntry',
      entryId: entryId('entry-1'),
      lines: balancedLines,
      memo: 'invoice #1',
      postedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.accounts['cash']).toEqual({ accountId: 'cash', balance: 500 });
    expect(result.value.context.accounts['revenue']).toEqual({ accountId: 'revenue', balance: -500 });
    expect(result.value.context.entries['entry-1']).toEqual({
      entryId: 'entry-1',
      lines: balancedLines,
      memo: 'invoice #1',
      status: 'posted',
      postedAt: '2026-07-20T00:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'EntryPosted', entryId: 'entry-1', lines: balancedLines, postedAt: '2026-07-20T00:00:00.000Z' },
    ]);
  });

  it('accumulates onto an existing account balance rather than overwriting it', () => {
    const withCash: LedgerContext = { accounts: { cash: { accountId: accountId('cash'), balance: 500 } }, entries: {} };

    const result = postEntryHandler(withCash, {
      kind: 'PostEntry',
      entryId: entryId('entry-2'),
      lines: [
        { accountId: accountId('cash'), direction: 'debit', amount: 200 },
        { accountId: accountId('revenue'), direction: 'credit', amount: 200 },
      ],
      memo: 'invoice #2',
      postedAt: isoTimestamp('2026-07-20T00:01:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.context.accounts['cash']).toEqual({ accountId: 'cash', balance: 700 });
  });

  it('never mutates the input context', () => {
    const before = JSON.stringify(emptyContext);

    postEntryHandler(emptyContext, {
      kind: 'PostEntry',
      entryId: entryId('entry-1'),
      lines: balancedLines,
      memo: 'invoice #1',
      postedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
    });

    expect(JSON.stringify(emptyContext)).toBe(before);
  });

  it('rejects posting the same entryId twice', () => {
    const withEntry: LedgerContext = {
      accounts: {},
      entries: {
        'entry-1': { entryId: entryId('entry-1'), lines: balancedLines, memo: 'first', status: 'posted', postedAt: isoTimestamp('2026-07-20T00:00:00.000Z') },
      },
    };

    const result = postEntryHandler(withEntry, {
      kind: 'PostEntry',
      entryId: entryId('entry-1'),
      lines: balancedLines,
      memo: 'duplicate',
      postedAt: isoTimestamp('2026-07-20T00:01:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'EntryAlreadyExists', entryId: 'entry-1' } });
  });

  it('rejects an entry with no lines', () => {
    const result = postEntryHandler(emptyContext, {
      kind: 'PostEntry',
      entryId: entryId('entry-1'),
      lines: [],
      memo: 'empty',
      postedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'EntryHasNoLines', entryId: 'entry-1' } });
  });

  it('rejects a line with a zero or negative amount', () => {
    const result = postEntryHandler(emptyContext, {
      kind: 'PostEntry',
      entryId: entryId('entry-1'),
      lines: [
        { accountId: accountId('cash'), direction: 'debit', amount: 0 },
        { accountId: accountId('revenue'), direction: 'credit', amount: 0 },
      ],
      memo: 'zero',
      postedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'InvalidLineAmount', entryId: 'entry-1', accountId: 'cash' } });
  });

  it('rejects a line with a non-integer amount', () => {
    const result = postEntryHandler(emptyContext, {
      kind: 'PostEntry',
      entryId: entryId('entry-1'),
      lines: [
        { accountId: accountId('cash'), direction: 'debit', amount: 5.5 },
        { accountId: accountId('revenue'), direction: 'credit', amount: 5.5 },
      ],
      memo: 'fractional',
      postedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'InvalidLineAmount', entryId: 'entry-1', accountId: 'cash' } });
  });

  it('rejects an entry whose debits do not equal its credits', () => {
    const result = postEntryHandler(emptyContext, {
      kind: 'PostEntry',
      entryId: entryId('entry-1'),
      lines: [
        { accountId: accountId('cash'), direction: 'debit', amount: 500 },
        { accountId: accountId('revenue'), direction: 'credit', amount: 400 },
      ],
      memo: 'unbalanced',
      postedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'EntryNotBalanced', entryId: 'entry-1', debitTotal: 500, creditTotal: 400 },
    });
  });

  it('balances across more than two lines, not just a simple debit/credit pair', () => {
    const result = postEntryHandler(emptyContext, {
      kind: 'PostEntry',
      entryId: entryId('entry-1'),
      lines: [
        { accountId: accountId('cash'), direction: 'debit', amount: 300 },
        { accountId: accountId('fees'), direction: 'debit', amount: 20 },
        { accountId: accountId('revenue'), direction: 'credit', amount: 320 },
      ],
      memo: 'split',
      postedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.context.accounts['cash']).toEqual({ accountId: 'cash', balance: 300 });
    expect(result.value.context.accounts['fees']).toEqual({ accountId: 'fees', balance: 20 });
    expect(result.value.context.accounts['revenue']).toEqual({ accountId: 'revenue', balance: -320 });
  });
});
