import { bookingId } from '../instructions/scheduling/ids.js';
import type { BookingId } from '../instructions/scheduling/ids.js';
import type { EncounterId } from '../instructions/patient/ids.js';
import type { SchedulingContext } from '../instructions/scheduling/types.js';

/**
 * Every still-`'scheduled'` booking whose `subjectId` matches a given
 * encounter — plural, the same lab/imaging reasoning: an encounter can
 * have many pending bookings at once (an OR slot, a piece of imaging
 * equipment, ...). Sorted for determinism, same reasoning as
 * `bedLookup.ts`'s `findBedHoldingEncounter`'s `matches.sort()`.
 *
 * Unlike lab's `LabOrderRecord.encounterId` or imaging's
 * `StudyRecord.encounterId` — both branded `EncounterId` fields —
 * `BookingRecord.subjectId` is a plain `string`, deliberately kept
 * generic (see `scheduling/types.ts`'s doc comment: a booking's subject
 * might be a patient's procedure, but might just as well be equipment
 * maintenance or a staff shift, neither of which has an encounter at
 * all). This lookup only finds bookings a caller chose to key by
 * `subjectId = encounterId` as a convention; nothing in scheduling's own
 * types enforces that link the way lab/imaging's foreign keys do. See
 * `docs/DETERMINISTIC_CORE_PATTERN.md`'s "Resolved: patientToScheduling.ts"
 * for what that weaker link means for this choreography specifically.
 */
export function findPendingBookingsForEncounter(context: SchedulingContext, encounterId: EncounterId): readonly BookingId[] {
  return Object.keys(context.bookings)
    .filter((id) => {
      const booking = context.bookings[id];
      return booking.status === 'scheduled' && booking.subjectId === encounterId;
    })
    .map((id) => bookingId(id))
    .sort();
}
