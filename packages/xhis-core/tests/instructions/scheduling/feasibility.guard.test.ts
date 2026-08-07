import { describe, expect, it } from 'vitest';
import { schedulingEngine } from '../../../src/instructions/scheduling/engine.js';
import { bookingId, isoTimestamp, resourceId } from '../../../src/instructions/scheduling/ids.js';
import type { SchedulingContext, SchedulingInstruction } from '../../../src/instructions/scheduling/types.js';

/**
 * The domain-specific invariant proof step for the optimization/
 * feasibility family (see docs/DETERMINISTIC_CORE_PATTERN.md) — a
 * pairwise invariant, not a sum invariant like `ledger`'s conservation
 * guard: no two `scheduled` bookings for the same resource may ever
 * overlap in time. Unlike the ledger guard (every generated entry is
 * constructed to already balance, so a rejection there would mean a
 * bug), this generator deliberately proposes overlapping bookings on
 * purpose — the interesting behavior under test is
 * `scheduleBookingHandler` correctly *rejecting* exactly those, not
 * accepting everything.
 */
function hasNoOverlaps(context: SchedulingContext): boolean {
  const scheduled = Object.values(context.bookings).filter((booking) => booking.status === 'scheduled');

  for (let i = 0; i < scheduled.length; i += 1) {
    for (let j = i + 1; j < scheduled.length; j += 1) {
      const a = scheduled[i]!;
      const b = scheduled[j]!;
      if (a.resourceId !== b.resourceId) continue;
      if (a.startAt < b.endAt && b.startAt < a.endAt) return false;
    }
  }

  return true;
}

/** A small deterministic linear-congruential generator — not
 * `Math.random()`, so a failing run is exactly reproducible from the
 * fixed seed below. */
function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** Minutes-since-midnight on a fixed day, kept well under 24h even after
 * adding the longest generated duration, so no case ever wraps past
 * midnight and breaks the string-comparison ordering `overlap.ts` relies
 * on. */
function formatTime(minutesSinceMidnight: number) {
  const hour = Math.floor(minutesSinceMidnight / 60);
  const minute = minutesSinceMidnight % 60;
  return isoTimestamp(`2026-07-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);
}

const RESOURCE_POOL = ['or-1', 'or-2', 'or-3'].map((id) => resourceId(id));

describe('scheduling feasibility invariant', () => {
  it('never lets two scheduled bookings on the same resource overlap, through many attempted (and often conflicting) bookings', () => {
    const rng = makeRng(7);
    let context: SchedulingContext = { bookings: {} };
    const scheduledIds: string[] = [];
    let accepted = 0;
    let rejectedForConflict = 0;

    expect(hasNoOverlaps(context)).toBe(true);

    for (let step = 0; step < 80; step += 1) {
      const shouldCancel = scheduledIds.length > 0 && rng() < 0.15;

      let instruction: SchedulingInstruction;

      if (shouldCancel) {
        const candidate = scheduledIds.splice(Math.floor(rng() * scheduledIds.length), 1)[0]!;
        instruction = { kind: 'CancelBooking', bookingId: bookingId(candidate), cancelledAt: formatTime(1350) };
      } else {
        const start = Math.floor(rng() * 1200);
        const duration = 15 + Math.floor(rng() * 105);

        instruction = {
          kind: 'ScheduleBooking',
          bookingId: bookingId(`booking-${step}`),
          resourceId: RESOURCE_POOL[Math.floor(rng() * RESOURCE_POOL.length)]!,
          subjectId: `case-${step}`,
          startAt: formatTime(start),
          endAt: formatTime(start + duration),
        };
      }

      const result = schedulingEngine.execute(context, instruction);

      if (result.ok) {
        context = result.value.context;
        if (instruction.kind === 'ScheduleBooking') {
          accepted += 1;
          scheduledIds.push(instruction.bookingId);
        }
      } else if (instruction.kind === 'ScheduleBooking' && result.error.kind === 'SchedulingConflict') {
        rejectedForConflict += 1;
      }

      // Checked after every instruction, accepted or rejected — a bug
      // that let even one conflicting booking slip through must fail
      // here immediately, not average out over the run.
      expect(hasNoOverlaps(context)).toBe(true);
    }

    // Confirm the generator actually exercised both outcomes — a run
    // that never triggered a conflict would only prove the happy path.
    expect(accepted).toBeGreaterThan(0);
    expect(rejectedForConflict).toBeGreaterThan(0);
  });

  it('confirms the guard is load-bearing: a state that skipped the overlap check is exactly the state that breaks the invariant', () => {
    // Not a call through `scheduleBookingHandler` (which correctly
    // rejects this) — a direct, deliberately-invalid context standing in
    // for "what if the overlap check above were ever removed or bypassed."
    const contextWithoutTheCheck: SchedulingContext = {
      bookings: {
        'booking-1': { bookingId: bookingId('booking-1'), resourceId: resourceId('or-1'), subjectId: 'case-1', startAt: isoTimestamp('2026-07-20T09:00:00.000Z'), endAt: isoTimestamp('2026-07-20T10:00:00.000Z'), status: 'scheduled' },
        'booking-2': { bookingId: bookingId('booking-2'), resourceId: resourceId('or-1'), subjectId: 'case-2', startAt: isoTimestamp('2026-07-20T09:30:00.000Z'), endAt: isoTimestamp('2026-07-20T10:30:00.000Z'), status: 'scheduled' },
      },
    };

    expect(hasNoOverlaps(contextWithoutTheCheck)).toBe(false);
  });
});
