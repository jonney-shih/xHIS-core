import type { SchedulingInstruction } from '../../instructions/scheduling/types.js';
import type { RiskTierRegistry } from './tiers.js';

/**
 * The fourth domain (after `lab`, `bed`, `ledger`) to get real
 * agentic-layer integration, continuing to close the gap
 * `docs/DETERMINISTIC_CORE_PATTERN.md` flagged.
 *
 * `ScheduleBooking` gets `'review-required'`: a wrong booking is
 * correctable by `CancelBooking`, the same shape `AdmitPatient` and
 * `PostEntry` get that tier for. `CancelBooking` gets
 * `'approval-required'` — checked directly against
 * `scheduleBookingHandler`, not assumed: it rejects with
 * `BookingAlreadyExists` for *any* existing `bookingId`, cancelled or
 * not (`if (ctx.bookings[instruction.bookingId])`, no status check).
 * So once a booking is cancelled, that exact `bookingId` can never be
 * scheduled again — recovering from a wrongful cancellation needs a
 * brand-new `bookingId`, the same "terminal within this domain" shape
 * `ReverseEntry` has, independently confirmed here by reading the
 * handler rather than assumed from ledger's precedent. Scheduling adds
 * its own extra consequence on top: the freed time range is now legally
 * bookable by someone else, so a wrongful cancellation can lose the
 * slot to a third party before anyone notices, not just require
 * re-entering the same data. Any new `SchedulingInstruction` variant
 * added without a tier here fails to compile; see
 * `__typetests__/scheduling.exhaustiveness.ts` for the proof.
 */
export const schedulingRiskTiers = {
  ScheduleBooking: 'review-required',
  CancelBooking: 'approval-required',
} satisfies RiskTierRegistry<SchedulingInstruction>;
