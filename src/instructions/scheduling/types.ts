import type { BookingId, IsoTimestamp, ResourceId } from './ids.js';

/**
 * The fifth domain, and the first from the **optimization/feasibility**
 * family (see docs/DETERMINISTIC_CORE_PATTERN.md's three-family
 * reclassification) — OR scheduling and roster generation are the named
 * examples; this is a minimal slice of the first: booking an exclusive
 * resource (an OR room, a piece of equipment — kept generic rather than
 * OR-specific, same restraint as `lab`'s `testCode` staying a plain
 * string, not a controlled vocabulary) for a time range.
 *
 * The invariant is neither a state machine (`bed`) nor conservation
 * (`ledger`) — it's hard **feasibility**: two `scheduled` bookings for
 * the same resource must never have overlapping time ranges, checked in
 * `handlers/overlap.ts`. This domain does not attempt to find a *good*
 * schedule — no optimization, no search, no "next available slot" — it
 * only makes an *infeasible* one structurally unable to commit, which is
 * the actual claim under test here.
 */
export interface BookingRecord {
  readonly bookingId: BookingId;
  readonly resourceId: ResourceId;
  readonly subjectId: string;
  readonly startAt: IsoTimestamp;
  readonly endAt: IsoTimestamp;
  readonly status: 'scheduled' | 'cancelled';
  readonly cancelledAt?: IsoTimestamp;
}

/** Plain, JSON-serializable state — see `PatientContext`'s doc comment
 * for why that matters. */
export interface SchedulingContext {
  readonly bookings: Readonly<Record<string, BookingRecord>>;
}

export type SchedulingInstruction =
  | {
      readonly kind: 'ScheduleBooking';
      readonly bookingId: BookingId;
      readonly resourceId: ResourceId;
      readonly subjectId: string;
      readonly startAt: IsoTimestamp;
      readonly endAt: IsoTimestamp;
    }
  | {
      readonly kind: 'CancelBooking';
      readonly bookingId: BookingId;
      readonly cancelledAt: IsoTimestamp;
    };

export type SchedulingEffect =
  | {
      readonly kind: 'BookingScheduled';
      readonly bookingId: BookingId;
      readonly resourceId: ResourceId;
      readonly subjectId: string;
      readonly startAt: IsoTimestamp;
      readonly endAt: IsoTimestamp;
    }
  | {
      readonly kind: 'BookingCancelled';
      readonly bookingId: BookingId;
      readonly resourceId: ResourceId;
      readonly cancelledAt: IsoTimestamp;
    };

export type SchedulingError =
  | { readonly kind: 'BookingAlreadyExists'; readonly bookingId: BookingId }
  | { readonly kind: 'BookingNotFound'; readonly bookingId: BookingId }
  | { readonly kind: 'BookingAlreadyCancelled'; readonly bookingId: BookingId }
  | { readonly kind: 'InvalidTimeRange'; readonly bookingId: BookingId }
  | {
      readonly kind: 'SchedulingConflict';
      readonly bookingId: BookingId;
      readonly conflictingBookingIds: readonly BookingId[];
    };
