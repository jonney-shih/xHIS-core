import { describe, expect, it } from 'vitest';
import { createCdssLedgerPlanner } from '../../../src/agentic/planning/cdssLedgerPlanner.js';
import type { LedgerReversalReadySignal } from '../../../src/agentic/planning/cdssLedgerPlanner.js';
import { accountId, entryId, isoTimestamp } from '../../../src/instructions/ledger/ids.js';
import type { LedgerContext } from '../../../src/instructions/ledger/types.js';

const emptyLedgerContext: LedgerContext = { accounts: {}, entries: {} };

describe('createCdssLedgerPlanner', () => {
  it('recommends reversal for a signal whose entry is still posted', async () => {
    const planner = createCdssLedgerPlanner();
    const context: LedgerContext = {
      accounts: {},
      entries: {
        'entry-1': {
          entryId: entryId('entry-1'),
          lines: [
            { accountId: accountId('cash'), direction: 'debit', amount: 500 },
            { accountId: accountId('revenue'), direction: 'credit', amount: 500 },
          ],
          memo: 'invoice #1',
          status: 'posted',
          postedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
        },
      },
    };
    const signal: LedgerReversalReadySignal = { entryId: entryId('entry-1') };

    const result = await planner.plan(
      { description: 'reconciliation sweep' },
      { ledgerContext: context, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      [],
    );

    expect(result).toEqual({
      ok: true,
      value: {
        instructions: [{ kind: 'ReverseEntry', entryId: 'entry-1', reversedAt: '2026-08-01T01:00:00.000Z' }],
        rationale: 'CDSS ledger rule: recommending reversal for 1 signal(s) whose entry is still posted',
        modelVersion: 'cdss-ledger-reversal-rule-engine-v1',
        promptVersion: 'ledger-reversal-ruleset-v1',
      },
    });
  });

  it('is idempotent: a signal for an entry already reversed produces no recommendation', async () => {
    const planner = createCdssLedgerPlanner();
    const context: LedgerContext = {
      accounts: {},
      entries: {
        'entry-1': {
          entryId: entryId('entry-1'),
          lines: [
            { accountId: accountId('cash'), direction: 'debit', amount: 500 },
            { accountId: accountId('revenue'), direction: 'credit', amount: 500 },
          ],
          memo: 'invoice #1',
          status: 'reversed',
          postedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
          reversedAt: isoTimestamp('2026-08-01T00:30:00.000Z'),
        },
      },
    };
    const signal: LedgerReversalReadySignal = { entryId: entryId('entry-1') };

    const result = await planner.plan({ description: 'reconciliation sweep' }, { ledgerContext: context, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  it('skips a signal naming an entryId that does not exist at all', async () => {
    const planner = createCdssLedgerPlanner();
    const signal: LedgerReversalReadySignal = { entryId: entryId('entry-unknown') };

    const result = await planner.plan({ description: 'reconciliation sweep' }, { ledgerContext: emptyLedgerContext, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  /**
   * The ledger-specific counterpart to `createCdssPharmacyPlanner`'s own
   * "recommends dispensing at most once" test — arrived at for the
   * identical reason: two `ReverseEntry` instructions for the same
   * `entryId` would doom the whole batch at Do time.
   */
  it('recommends reversal at most once even if the same entryId is signaled twice in one batch', async () => {
    const planner = createCdssLedgerPlanner();
    const context: LedgerContext = {
      accounts: {},
      entries: {
        'entry-1': {
          entryId: entryId('entry-1'),
          lines: [
            { accountId: accountId('cash'), direction: 'debit', amount: 500 },
            { accountId: accountId('revenue'), direction: 'credit', amount: 500 },
          ],
          memo: 'invoice #1',
          status: 'posted',
          postedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
        },
      },
    };
    const signals: readonly LedgerReversalReadySignal[] = [{ entryId: entryId('entry-1') }, { entryId: entryId('entry-1') }];

    const result = await planner.plan({ description: 'reconciliation sweep' }, { ledgerContext: context, signals }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([
      { kind: 'ReverseEntry', entryId: 'entry-1', reversedAt: '2026-08-01T01:00:00.000Z' },
    ]);
  });

  it('handles multiple independent signals for distinct entries without any cross-signal interaction', async () => {
    const planner = createCdssLedgerPlanner();
    const context: LedgerContext = {
      accounts: {},
      entries: {
        'entry-1': {
          entryId: entryId('entry-1'),
          lines: [
            { accountId: accountId('cash'), direction: 'debit', amount: 500 },
            { accountId: accountId('revenue'), direction: 'credit', amount: 500 },
          ],
          memo: 'invoice #1',
          status: 'posted',
          postedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
        },
        'entry-2': {
          entryId: entryId('entry-2'),
          lines: [
            { accountId: accountId('cash'), direction: 'debit', amount: 200 },
            { accountId: accountId('revenue'), direction: 'credit', amount: 200 },
          ],
          memo: 'invoice #2',
          status: 'posted',
          postedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
        },
      },
    };
    const signals: readonly LedgerReversalReadySignal[] = [{ entryId: entryId('entry-1') }, { entryId: entryId('entry-2') }];

    const result = await planner.plan({ description: 'reconciliation sweep' }, { ledgerContext: context, signals }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([
      { kind: 'ReverseEntry', entryId: 'entry-1', reversedAt: '2026-08-01T01:00:00.000Z' },
      { kind: 'ReverseEntry', entryId: 'entry-2', reversedAt: '2026-08-01T01:00:00.000Z' },
    ]);
  });

  it('ignores feedback — the rule is a pure function of context and signals, not of prior attempts', async () => {
    const planner = createCdssLedgerPlanner();
    const context: LedgerContext = {
      accounts: {},
      entries: {
        'entry-1': {
          entryId: entryId('entry-1'),
          lines: [
            { accountId: accountId('cash'), direction: 'debit', amount: 500 },
            { accountId: accountId('revenue'), direction: 'credit', amount: 500 },
          ],
          memo: 'invoice #1',
          status: 'posted',
          postedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
        },
      },
    };
    const signal: LedgerReversalReadySignal = { entryId: entryId('entry-1') };

    const first = await planner.plan({ description: 'reconciliation sweep' }, { ledgerContext: context, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);
    const second = await planner.plan(
      { description: 'reconciliation sweep' },
      { ledgerContext: context, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      ['some prior feedback that a deterministic rule has no way to act on'],
    );

    expect(first).toEqual(second);
  });
});
