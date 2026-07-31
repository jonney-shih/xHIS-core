import { describe, expect, it } from 'vitest';
import { createCdssSchedulingPlanner } from '../../../src/agentic/planning/cdssSchedulingPlanner.js';
import type { SchedulingDischargeSignal } from '../../../src/agentic/planning/cdssSchedulingPlanner.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import { bookingId, isoTimestamp, resourceId } from '../../../src/instructions/scheduling/ids.js';
import type { SchedulingContext } from '../../../src/instructions/scheduling/types.js';

const emptySchedulingContext: SchedulingContext = { bookings: {} };

describe('createCdssSchedulingPlanner', () => {
  it('recommends cancellation of a single pending booking for a discharge signal', async () => {
    const planner = createCdssSchedulingPlanner();
    const context: SchedulingContext = {
      bookings: {
        'booking-1': {
          bookingId: bookingId('booking-1'),
          resourceId: resourceId('or-1'),
          subjectId: 'encounter-1',
          startAt: isoTimestamp('2026-08-01T09:00:00.000Z'),
          endAt: isoTimestamp('2026-08-01T10:00:00.000Z'),
          status: 'scheduled',
        },
      },
    };
    const signal: SchedulingDischargeSignal = { encounterId: encounterId('encounter-1') };

    const result = await planner.plan(
      { description: 'discharge sweep' },
      { schedulingContext: context, signals: [signal] },
      '2026-08-01T11:00:00.000Z',
      [],
    );

    expect(result).toEqual({
      ok: true,
      value: {
        instructions: [{ kind: 'CancelBooking', bookingId: 'booking-1', cancelledAt: '2026-08-01T11:00:00.000Z' }],
        rationale: 'CDSS scheduling rule: recommending cancellation of 1 pending booking(s) across 1 discharge signal(s)',
        modelVersion: 'cdss-scheduling-cancellation-rule-engine-v1',
        promptVersion: 'scheduling-cancellation-ruleset-v1',
      },
    });
  });

  it('is naturally idempotent: a discharge signal for an encounter with nothing pending produces no recommendation', async () => {
    const planner = createCdssSchedulingPlanner();
    const context: SchedulingContext = {
      bookings: {
        'booking-1': {
          bookingId: bookingId('booking-1'),
          resourceId: resourceId('or-1'),
          subjectId: 'encounter-1',
          startAt: isoTimestamp('2026-08-01T09:00:00.000Z'),
          endAt: isoTimestamp('2026-08-01T10:00:00.000Z'),
          status: 'cancelled',
          cancelledAt: isoTimestamp('2026-08-01T09:30:00.000Z'),
        },
      },
    };
    const signal: SchedulingDischargeSignal = { encounterId: encounterId('encounter-1') };

    const result = await planner.plan({ description: 'discharge sweep' }, { schedulingContext: context, signals: [signal] }, '2026-08-01T11:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  it('produces no recommendation for a signal whose encounter has never had any booking at all', async () => {
    const planner = createCdssSchedulingPlanner();
    const signal: SchedulingDischargeSignal = { encounterId: encounterId('encounter-1') };

    const result = await planner.plan({ description: 'discharge sweep' }, { schedulingContext: emptySchedulingContext, signals: [signal] }, '2026-08-01T11:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  it('correctly ignores a booking whose subjectId matches nothing, even if it looks like it could be an encounter', async () => {
    const planner = createCdssSchedulingPlanner();
    const context: SchedulingContext = {
      bookings: {
        // subjectId here is equipment, not an encounter -- must never be
        // recommended for cancellation by a discharge signal for a
        // *different* subjectId.
        'booking-1': { bookingId: bookingId('booking-1'), resourceId: resourceId('or-1'), subjectId: 'or-1-maintenance', startAt: isoTimestamp('2026-08-01T09:00:00.000Z'), endAt: isoTimestamp('2026-08-01T10:00:00.000Z'), status: 'scheduled' },
      },
    };
    const signal: SchedulingDischargeSignal = { encounterId: encounterId('encounter-1') };

    const result = await planner.plan({ description: 'discharge sweep' }, { schedulingContext: context, signals: [signal] }, '2026-08-01T11:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  /**
   * The many-to-one proof, mirroring `cdssLabPlanner.test.ts`'s own
   * equivalent: one signal, multiple pending bookings for the same
   * encounter, must produce one `CancelBooking` per booking.
   */
  it('recommends cancellation of every pending booking for a single discharge signal, not just one', async () => {
    const planner = createCdssSchedulingPlanner();
    const context: SchedulingContext = {
      bookings: {
        'booking-2': { bookingId: bookingId('booking-2'), resourceId: resourceId('or-2'), subjectId: 'encounter-1', startAt: isoTimestamp('2026-08-01T11:00:00.000Z'), endAt: isoTimestamp('2026-08-01T12:00:00.000Z'), status: 'scheduled' },
        'booking-1': { bookingId: bookingId('booking-1'), resourceId: resourceId('or-1'), subjectId: 'encounter-1', startAt: isoTimestamp('2026-08-01T09:00:00.000Z'), endAt: isoTimestamp('2026-08-01T10:00:00.000Z'), status: 'scheduled' },
      },
    };
    const signal: SchedulingDischargeSignal = { encounterId: encounterId('encounter-1') };

    const result = await planner.plan({ description: 'discharge sweep' }, { schedulingContext: context, signals: [signal] }, '2026-08-01T13:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // Sorted for determinism, the same guarantee findPendingBookingsForEncounter's own doc comment gives.
    expect(result.value.instructions).toEqual([
      { kind: 'CancelBooking', bookingId: 'booking-1', cancelledAt: '2026-08-01T13:00:00.000Z' },
      { kind: 'CancelBooking', bookingId: 'booking-2', cancelledAt: '2026-08-01T13:00:00.000Z' },
    ]);
  });

  it('handles multiple independent discharge signals without any cross-signal interaction', async () => {
    const planner = createCdssSchedulingPlanner();
    const context: SchedulingContext = {
      bookings: {
        'booking-1': { bookingId: bookingId('booking-1'), resourceId: resourceId('or-1'), subjectId: 'encounter-1', startAt: isoTimestamp('2026-08-01T09:00:00.000Z'), endAt: isoTimestamp('2026-08-01T10:00:00.000Z'), status: 'scheduled' },
        'booking-2': { bookingId: bookingId('booking-2'), resourceId: resourceId('or-2'), subjectId: 'encounter-2', startAt: isoTimestamp('2026-08-01T09:00:00.000Z'), endAt: isoTimestamp('2026-08-01T10:00:00.000Z'), status: 'scheduled' },
      },
    };
    const signals: readonly SchedulingDischargeSignal[] = [{ encounterId: encounterId('encounter-1') }, { encounterId: encounterId('encounter-2') }];

    const result = await planner.plan({ description: 'discharge sweep' }, { schedulingContext: context, signals }, '2026-08-01T11:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([
      { kind: 'CancelBooking', bookingId: 'booking-1', cancelledAt: '2026-08-01T11:00:00.000Z' },
      { kind: 'CancelBooking', bookingId: 'booking-2', cancelledAt: '2026-08-01T11:00:00.000Z' },
    ]);
  });

  it('ignores feedback — the rule is a pure function of context and signals, not of prior attempts', async () => {
    const planner = createCdssSchedulingPlanner();
    const context: SchedulingContext = {
      bookings: { 'booking-1': { bookingId: bookingId('booking-1'), resourceId: resourceId('or-1'), subjectId: 'encounter-1', startAt: isoTimestamp('2026-08-01T09:00:00.000Z'), endAt: isoTimestamp('2026-08-01T10:00:00.000Z'), status: 'scheduled' } },
    };
    const signal: SchedulingDischargeSignal = { encounterId: encounterId('encounter-1') };

    const first = await planner.plan({ description: 'discharge sweep' }, { schedulingContext: context, signals: [signal] }, '2026-08-01T11:00:00.000Z', []);
    const second = await planner.plan(
      { description: 'discharge sweep' },
      { schedulingContext: context, signals: [signal] },
      '2026-08-01T11:00:00.000Z',
      ['some prior feedback that a deterministic rule has no way to act on'],
    );

    expect(first).toEqual(second);
  });
});
