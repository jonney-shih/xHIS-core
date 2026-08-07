import type { Kinded } from '../../core/execution/kinded.js';
import type { Verifier } from './verifier.js';

/**
 * A business rule Do can't catch on its own: nothing about executing a
 * sequence one instruction at a time flags "this batch is unusually large
 * for one proposal" — that's a property of the batch as a whole, not any
 * one instruction in it. `needs-human-approval` rather than `reject`,
 * because size alone doesn't make a proposal wrong (a real end-of-day mass
 * discharge could legitimately be this big) — it just means a human should
 * look before it commits.
 */
export function createMaxBatchSizeVerifier<TInstruction extends Kinded>(
  maxInstructions: number,
): Verifier<TInstruction> {
  return {
    verify(proposal) {
      if (proposal.instructions.length <= maxInstructions) {
        return { kind: 'accept' };
      }

      return {
        kind: 'needs-human-approval',
        reasons: [
          `proposal contains ${proposal.instructions.length} instructions, exceeding the auto-reviewable limit of ${maxInstructions}`,
        ],
      };
    },
  };
}
