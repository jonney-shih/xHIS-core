import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { SchedulingContext, SchedulingEffect, SchedulingError, SchedulingInstruction } from '../types.js';

type CancelBooking = Extract<SchedulingInstruction, { kind: 'CancelBooking' }>;

/** Takes only `bookingId`, mirroring `ReleaseBed`/`CancelLabOrder`: the
 * handler reads `resourceId` back off the existing record rather than
 * trusting caller-supplied data. Cancelling frees the interval for that
 * resource — a booking made only after this commits can now legally
 * overlap where this one used to sit. */
export const cancelBookingHandler: Handler<SchedulingContext, CancelBooking, SchedulingEffect, SchedulingError> = (
  ctx,
  instruction,
) => {
  const existing = ctx.bookings[instruction.bookingId];

  if (!existing) {
    return err({ kind: 'BookingNotFound', bookingId: instruction.bookingId });
  }

  if (existing.status === 'cancelled') {
    return err({ kind: 'BookingAlreadyCancelled', bookingId: instruction.bookingId });
  }

  const context: SchedulingContext = {
    bookings: {
      ...ctx.bookings,
      [instruction.bookingId]: { ...existing, status: 'cancelled', cancelledAt: instruction.cancelledAt },
    },
  };

  return ok({
    context,
    effects: [
      { kind: 'BookingCancelled', bookingId: instruction.bookingId, resourceId: existing.resourceId, cancelledAt: instruction.cancelledAt },
    ],
  });
};
