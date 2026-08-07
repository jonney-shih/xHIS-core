import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { LedgerContext, LedgerEffect, LedgerError, LedgerInstruction } from '../types.js';
import { applyLines } from './applyLines.js';

type ReverseEntry = Extract<LedgerInstruction, { kind: 'ReverseEntry' }>;

/**
 * Reverses by re-applying the original entry's own `lines` with the sign
 * flipped (`applyLines(..., -1)`) — not by hand-computing an "opposite"
 * entry, so the reversal is provably the exact inverse of the post, not
 * a second implementation that could drift. Takes only `entryId`,
 * mirroring `ReleaseBed`/`CancelLabOrder`: the handler reads the lines
 * back off the existing record rather than trusting caller-supplied data.
 */
export const reverseEntryHandler: Handler<LedgerContext, ReverseEntry, LedgerEffect, LedgerError> = (
  ctx,
  instruction,
) => {
  const existing = ctx.entries[instruction.entryId];

  if (!existing) {
    return err({ kind: 'EntryNotFound', entryId: instruction.entryId });
  }

  if (existing.status === 'reversed') {
    return err({ kind: 'EntryAlreadyReversed', entryId: instruction.entryId });
  }

  const context: LedgerContext = {
    accounts: applyLines(ctx.accounts, existing.lines, -1),
    entries: {
      ...ctx.entries,
      [instruction.entryId]: { ...existing, status: 'reversed', reversedAt: instruction.reversedAt },
    },
  };

  return ok({
    context,
    effects: [{ kind: 'EntryReversed', entryId: instruction.entryId, reversedAt: instruction.reversedAt }],
  });
};
