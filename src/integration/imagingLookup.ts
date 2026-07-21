import { studyId } from '../instructions/imaging/ids.js';
import type { EncounterId, StudyId } from '../instructions/imaging/ids.js';
import type { ImagingContext } from '../instructions/imaging/types.js';

/**
 * Every still-`'ordered'` (not yet performed) study for a given
 * encounter — mirrors `src/integration/labLookup.ts`'s
 * `findPendingLabOrdersForEncounter` exactly, plural for the same
 * reason: an encounter can have many pending imaging orders at once.
 * Sorted for determinism, same reasoning as `findBedHoldingEncounter`'s
 * `matches.sort()`.
 */
export function findPendingStudiesForEncounter(context: ImagingContext, encounterId: EncounterId): readonly StudyId[] {
  return Object.keys(context.studies)
    .filter((id) => {
      const study = context.studies[id];
      return study.status === 'ordered' && study.encounterId === encounterId;
    })
    .map((id) => studyId(id))
    .sort();
}
