import { bedId } from '../instructions/bed/ids.js';
import type { BedId, EncounterId } from '../instructions/bed/ids.js';
import type { BedContext } from '../instructions/bed/types.js';

export type BedLookup =
  | { readonly kind: 'found'; readonly bedId: BedId }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ambiguous'; readonly bedIds: readonly BedId[] };

/**
 * Finds the bed currently occupied by a given encounter — not a
 * "strategy" like `BedSelectionStrategy`, there's no policy choice here,
 * just a lookup over existing data. `ambiguous` covers a data-integrity
 * case that shouldn't be reachable through `AssignBed`'s own invariant
 * (an `encounterId` is only ever set when transitioning a single bed
 * from available to occupied) but is reported rather than silently
 * resolved by picking one — consistent with this codebase's "no silent
 * failure" discipline elsewhere (`validateInstruction`, `resolveApproval`,
 * the determinism guard, ...).
 */
export function findBedHoldingEncounter(context: BedContext, encounterId: EncounterId): BedLookup {
  const matches = Object.keys(context.beds)
    .filter((id) => {
      const bed = context.beds[id];
      return bed.status === 'occupied' && bed.encounterId === encounterId;
    })
    .map((id) => bedId(id))
    .sort();

  if (matches.length === 0) {
    return { kind: 'not-found' };
  }

  if (matches.length > 1) {
    return { kind: 'ambiguous', bedIds: matches };
  }

  return { kind: 'found', bedId: matches[0]! };
}
