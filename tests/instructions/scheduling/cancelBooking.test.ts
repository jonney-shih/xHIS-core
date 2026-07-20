import { describe, expect, it } from 'vitest';
import { cancelBookingHandler } from '../../../src/instructions/scheduling/handlers/cancelBooking.js';
import { bookingId, isoTimestamp, resourceId } from '../../../src/instructions/scheduling/ids.js';
import type { SchedulingContext } from '../../../src/instructions/scheduling/types.js';

const orRoom = resourceId('or-1');

const contextWithScheduledBooking: SchedulingContext = {
  bookings: {
    'booking-1': {
      bookingId: bookingId('booking-1'),
      resourceId: orRoom,
      subjectId: 'case-1',
      startAt: isoTimestamp('2026-07-20T09:00:00.000Z'),
      endAt: isoTimestamp('2026-07-20T10:00:00.000Z'),
      status: 'scheduled',
    },
  },
};

describe('cancelBookingHandler', () => {
  it('cancels a scheduled booking and emits a BookingCancelled effect', () => {
    const result = cancelBookingHandler(contextWithScheduledBooking, {
      kind: 'CancelBooking',
      bookingId: bookingId('booking-1'),
      cancelledAt: isoTimestamp('2026-07-20T08:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.bookings['booking-1']).toEqual({
      bookingId: 'booking-1',
      resourceId: 'or-1',
      subjectId: 'case-1',
      startAt: '2026-07-20T09:00:00.000Z',
      endAt: '2026-07-20T10:00:00.000Z',
      status: 'cancelled',
      cancelledAt: '2026-07-20T08:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'BookingCancelled', bookingId: 'booking-1', resourceId: 'or-1', cancelledAt: '2026-07-20T08:00:00.000Z' },
    ]);
  });

  it('rejects cancelling a booking that does not exist', () => {
    const result = cancelBookingHandler(
      { bookings: {} },
      { kind: 'CancelBooking', bookingId: bookingId('booking-1'), cancelledAt: isoTimestamp('2026-07-20T08:00:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'BookingNotFound', bookingId: 'booking-1' } });
  });

  it('rejects cancelling a booking that is already cancelled', () => {
    const alreadyCancelled: SchedulingContext = {
      bookings: {
        'booking-1': { ...contextWithScheduledBooking.bookings['booking-1']!, status: 'cancelled', cancelledAt: isoTimestamp('2026-07-20T07:00:00.000Z') },
      },
    };

    const result = cancelBookingHandler(alreadyCancelled, {
      kind: 'CancelBooking',
      bookingId: bookingId('booking-1'),
      cancelledAt: isoTimestamp('2026-07-20T08:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'BookingAlreadyCancelled', bookingId: 'booking-1' } });
  });
});
