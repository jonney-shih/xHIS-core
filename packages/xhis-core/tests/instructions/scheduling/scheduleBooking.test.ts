import { describe, expect, it } from 'vitest';
import { scheduleBookingHandler } from '../../../src/instructions/scheduling/handlers/scheduleBooking.js';
import { bookingId, isoTimestamp, resourceId } from '../../../src/instructions/scheduling/ids.js';
import type { SchedulingContext } from '../../../src/instructions/scheduling/types.js';

const emptyContext: SchedulingContext = { bookings: {} };

const orRoom = resourceId('or-1');

describe('scheduleBookingHandler', () => {
  it('schedules a booking and emits a BookingScheduled effect', () => {
    const result = scheduleBookingHandler(emptyContext, {
      kind: 'ScheduleBooking',
      bookingId: bookingId('booking-1'),
      resourceId: orRoom,
      subjectId: 'case-1',
      startAt: isoTimestamp('2026-07-20T09:00:00.000Z'),
      endAt: isoTimestamp('2026-07-20T10:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.bookings['booking-1']).toEqual({
      bookingId: 'booking-1',
      resourceId: 'or-1',
      subjectId: 'case-1',
      startAt: '2026-07-20T09:00:00.000Z',
      endAt: '2026-07-20T10:00:00.000Z',
      status: 'scheduled',
    });
    expect(result.value.effects).toEqual([
      {
        kind: 'BookingScheduled',
        bookingId: 'booking-1',
        resourceId: 'or-1',
        subjectId: 'case-1',
        startAt: '2026-07-20T09:00:00.000Z',
        endAt: '2026-07-20T10:00:00.000Z',
      },
    ]);
  });

  it('never mutates the input context', () => {
    const before = JSON.stringify(emptyContext);

    scheduleBookingHandler(emptyContext, {
      kind: 'ScheduleBooking',
      bookingId: bookingId('booking-1'),
      resourceId: orRoom,
      subjectId: 'case-1',
      startAt: isoTimestamp('2026-07-20T09:00:00.000Z'),
      endAt: isoTimestamp('2026-07-20T10:00:00.000Z'),
    });

    expect(JSON.stringify(emptyContext)).toBe(before);
  });

  it('rejects scheduling the same bookingId twice', () => {
    const withBooking: SchedulingContext = {
      bookings: {
        'booking-1': { bookingId: bookingId('booking-1'), resourceId: orRoom, subjectId: 'case-1', startAt: isoTimestamp('2026-07-20T09:00:00.000Z'), endAt: isoTimestamp('2026-07-20T10:00:00.000Z'), status: 'scheduled' },
      },
    };

    const result = scheduleBookingHandler(withBooking, {
      kind: 'ScheduleBooking',
      bookingId: bookingId('booking-1'),
      resourceId: resourceId('or-2'),
      subjectId: 'case-2',
      startAt: isoTimestamp('2026-07-21T09:00:00.000Z'),
      endAt: isoTimestamp('2026-07-21T10:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'BookingAlreadyExists', bookingId: 'booking-1' } });
  });

  it('rejects a time range where the end is not after the start', () => {
    const result = scheduleBookingHandler(emptyContext, {
      kind: 'ScheduleBooking',
      bookingId: bookingId('booking-1'),
      resourceId: orRoom,
      subjectId: 'case-1',
      startAt: isoTimestamp('2026-07-20T10:00:00.000Z'),
      endAt: isoTimestamp('2026-07-20T09:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'InvalidTimeRange', bookingId: 'booking-1' } });
  });

  it('rejects a booking that overlaps an existing scheduled booking on the same resource', () => {
    const withBooking: SchedulingContext = {
      bookings: {
        'booking-1': { bookingId: bookingId('booking-1'), resourceId: orRoom, subjectId: 'case-1', startAt: isoTimestamp('2026-07-20T09:00:00.000Z'), endAt: isoTimestamp('2026-07-20T10:00:00.000Z'), status: 'scheduled' },
      },
    };

    const result = scheduleBookingHandler(withBooking, {
      kind: 'ScheduleBooking',
      bookingId: bookingId('booking-2'),
      resourceId: orRoom,
      subjectId: 'case-2',
      startAt: isoTimestamp('2026-07-20T09:30:00.000Z'),
      endAt: isoTimestamp('2026-07-20T10:30:00.000Z'),
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'SchedulingConflict', bookingId: 'booking-2', conflictingBookingIds: ['booking-1'] },
    });
  });

  it('allows a back-to-back booking that starts exactly when the other ends (half-open interval)', () => {
    const withBooking: SchedulingContext = {
      bookings: {
        'booking-1': { bookingId: bookingId('booking-1'), resourceId: orRoom, subjectId: 'case-1', startAt: isoTimestamp('2026-07-20T09:00:00.000Z'), endAt: isoTimestamp('2026-07-20T10:00:00.000Z'), status: 'scheduled' },
      },
    };

    const result = scheduleBookingHandler(withBooking, {
      kind: 'ScheduleBooking',
      bookingId: bookingId('booking-2'),
      resourceId: orRoom,
      subjectId: 'case-2',
      startAt: isoTimestamp('2026-07-20T10:00:00.000Z'),
      endAt: isoTimestamp('2026-07-20T11:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
  });

  it('allows an overlapping time range on a different resource', () => {
    const withBooking: SchedulingContext = {
      bookings: {
        'booking-1': { bookingId: bookingId('booking-1'), resourceId: orRoom, subjectId: 'case-1', startAt: isoTimestamp('2026-07-20T09:00:00.000Z'), endAt: isoTimestamp('2026-07-20T10:00:00.000Z'), status: 'scheduled' },
      },
    };

    const result = scheduleBookingHandler(withBooking, {
      kind: 'ScheduleBooking',
      bookingId: bookingId('booking-2'),
      resourceId: resourceId('or-2'),
      subjectId: 'case-2',
      startAt: isoTimestamp('2026-07-20T09:30:00.000Z'),
      endAt: isoTimestamp('2026-07-20T10:30:00.000Z'),
    });

    expect(result.ok).toBe(true);
  });

  it('allows a new booking where an overlapping-in-time slot exists but is cancelled', () => {
    const withCancelledBooking: SchedulingContext = {
      bookings: {
        'booking-1': { bookingId: bookingId('booking-1'), resourceId: orRoom, subjectId: 'case-1', startAt: isoTimestamp('2026-07-20T09:00:00.000Z'), endAt: isoTimestamp('2026-07-20T10:00:00.000Z'), status: 'cancelled', cancelledAt: isoTimestamp('2026-07-20T08:00:00.000Z') },
      },
    };

    const result = scheduleBookingHandler(withCancelledBooking, {
      kind: 'ScheduleBooking',
      bookingId: bookingId('booking-2'),
      resourceId: orRoom,
      subjectId: 'case-2',
      startAt: isoTimestamp('2026-07-20T09:30:00.000Z'),
      endAt: isoTimestamp('2026-07-20T10:30:00.000Z'),
    });

    expect(result.ok).toBe(true);
  });
});
