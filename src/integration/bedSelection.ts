import { bedId } from '../instructions/bed/ids.js';
import type { BedId } from '../instructions/bed/ids.js';
import type { BedContext } from '../instructions/bed/types.js';

export interface BedSelectionStrategy {
  selectAvailableBed(context: BedContext): BedId | undefined;
}

/**
 * Illustrative, not authoritative — same caveat as
 * `EXAMPLE_patientApprovalPolicy` in docs/AGENTIC_LAYER.md, applied here.
 * Picks the lexicographically-first available bed ID. A real bed
 * allocation policy would consider ward matching, isolation requirements,
 * patient acuity, and more — none of that is modeled here, on purpose:
 * there's no real requirement to model yet, and guessing one would just
 * be inventing arbitrary rules the way a fabricated role taxonomy would.
 */
export const EXAMPLE_firstAvailableBedStrategy: BedSelectionStrategy = {
  selectAvailableBed(context) {
    const availableBedIds = Object.keys(context.beds)
      .filter((id) => context.beds[id].status === 'available')
      .sort();

    return availableBedIds.length > 0 ? bedId(availableBedIds[0]!) : undefined;
  },
};
