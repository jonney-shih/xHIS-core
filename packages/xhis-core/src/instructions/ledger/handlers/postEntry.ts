import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { LedgerContext, LedgerEffect, LedgerError, LedgerInstruction } from '../types.js';
import { applyLines } from './applyLines.js';

type PostEntry = Extract<LedgerInstruction, { kind: 'PostEntry' }>;

/**
 * The domain-specific invariant proof step for the conservation family
 * (see `types.ts`'s doc comment): this handler is the *only* place a
 * `LedgerLine[]` is ever checked for balance, and it rejects outright
 * rather than posting an unbalanced entry and "fixing it up" later —
 * same "no silent failure" discipline as `validateInstruction`,
 * `resolveApproval`, and the determinism guard elsewhere in this
 * codebase. As long as every posted entry passes this check, the whole
 * ledger's total balance can never move away from zero — see
 * `tests/instructions/ledger/conservation.guard.test.ts` for the
 * empirical proof across many entries and reversals.
 */
export const postEntryHandler: Handler<LedgerContext, PostEntry, LedgerEffect, LedgerError> = (ctx, instruction) => {
  if (ctx.entries[instruction.entryId]) {
    return err({ kind: 'EntryAlreadyExists', entryId: instruction.entryId });
  }

  if (instruction.lines.length === 0) {
    return err({ kind: 'EntryHasNoLines', entryId: instruction.entryId });
  }

  for (const line of instruction.lines) {
    if (!Number.isInteger(line.amount) || line.amount <= 0) {
      return err({ kind: 'InvalidLineAmount', entryId: instruction.entryId, accountId: line.accountId });
    }
  }

  let debitTotal = 0;
  let creditTotal = 0;
  for (const line of instruction.lines) {
    if (line.direction === 'debit') debitTotal += line.amount;
    else creditTotal += line.amount;
  }

  if (debitTotal !== creditTotal) {
    return err({ kind: 'EntryNotBalanced', entryId: instruction.entryId, debitTotal, creditTotal });
  }

  const context: LedgerContext = {
    accounts: applyLines(ctx.accounts, instruction.lines, 1),
    entries: {
      ...ctx.entries,
      [instruction.entryId]: {
        entryId: instruction.entryId,
        lines: instruction.lines,
        memo: instruction.memo,
        status: 'posted',
        postedAt: instruction.postedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      { kind: 'EntryPosted', entryId: instruction.entryId, lines: instruction.lines, postedAt: instruction.postedAt },
    ],
  });
};
