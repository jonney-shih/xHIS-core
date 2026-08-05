import { bookingId } from '../ids.js';
import type { BookingId, IsoTimestamp, ResourceId } from '../ids.js';
import type { SchedulingContext } from '../types.js';

/**
 * Plain string comparison, not a built-in date-parsing constructor —
 * every `IsoTimestamp` in this codebase is a fixed-width, zero-padded,
 * UTC ("Z"-suffixed) ISO-8601 string, so lexicographic ordering already
 * matches chronological ordering. This isn't just a shortcut; it's
 * required — the determinism guard
 * (`tests/instructions/patient/determinism.guard.test.ts`) bans
 * constructing that object anywhere under `src/instructions`, since date
 * parsing can be timezone/locale-sensitive in ways plain string
 * comparison never is. Half-open intervals (`[startAt, endAt)`): a
 * booking ending exactly when another starts does not conflict.
 */
function intervalsOverlap(aStart: IsoTimestamp, aEnd: IsoTimestamp, bStart: IsoTimestamp, bEnd: IsoTimestamp): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * The domain-specific invariant proof for the optimization/feasibility
 * family: every currently-`scheduled` booking for `resourceId` that
 * overlaps `[startAt, endAt)` is a hard conflict — there is no "mostly
 * fits" for a shared physical resource. Unlike `bed`'s no-double-booking
 * check (one status field, O(1)) or `ledger`'s balance check (one sum,
 * O(n) in the entry's own lines), this has to scan every other booking
 * for the same resource and test for interval overlap — a genuinely
 * different *shape* of invariant check, not just different content.
 */
export function findConflicts(
  context: SchedulingContext,
  resourceId: ResourceId,
  startAt: IsoTimestamp,
  endAt: IsoTimestamp,
): readonly BookingId[] {
  return Object.keys(context.bookings)
    .filter((id) => {
      const booking = context.bookings[id];
      return (
        booking.status === 'scheduled' &&
        booking.resourceId === resourceId &&
        intervalsOverlap(startAt, endAt, booking.startAt, booking.endAt)
      );
    })
    .map((id) => bookingId(id))
    .sort();
}
