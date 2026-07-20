import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { SchedulingContext, SchedulingEffect, SchedulingError, SchedulingInstruction } from '../types.js';
import { findConflicts } from './overlap.js';

type ScheduleBooking = Extract<SchedulingInstruction, { kind: 'ScheduleBooking' }>;

export const scheduleBookingHandler: Handler<SchedulingContext, ScheduleBooking, SchedulingEffect, SchedulingError> = (
  ctx,
  instruction,
) => {
  if (ctx.bookings[instruction.bookingId]) {
    return err({ kind: 'BookingAlreadyExists', bookingId: instruction.bookingId });
  }

  if (!(instruction.startAt < instruction.endAt)) {
    return err({ kind: 'InvalidTimeRange', bookingId: instruction.bookingId });
  }

  const conflicts = findConflicts(ctx, instruction.resourceId, instruction.startAt, instruction.endAt);

  if (conflicts.length > 0) {
    return err({ kind: 'SchedulingConflict', bookingId: instruction.bookingId, conflictingBookingIds: conflicts });
  }

  const context: SchedulingContext = {
    bookings: {
      ...ctx.bookings,
      [instruction.bookingId]: {
        bookingId: instruction.bookingId,
        resourceId: instruction.resourceId,
        subjectId: instruction.subjectId,
        startAt: instruction.startAt,
        endAt: instruction.endAt,
        status: 'scheduled',
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'BookingScheduled',
        bookingId: instruction.bookingId,
        resourceId: instruction.resourceId,
        subjectId: instruction.subjectId,
        startAt: instruction.startAt,
        endAt: instruction.endAt,
      },
    ],
  });
};
