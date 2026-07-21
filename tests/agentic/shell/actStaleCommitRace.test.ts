import { describe, expect, it } from 'vitest';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { schedulingEngine } from '../../../src/instructions/scheduling/engine.js';
import { bookingId, isoTimestamp, resourceId } from '../../../src/instructions/scheduling/ids.js';
import type { SchedulingContext, SchedulingEffect, SchedulingInstruction } from '../../../src/instructions/scheduling/types.js';

const emptyContext: SchedulingContext = { bookings: {} };

function bookingProposal(id: string, startAt: string, endAt: string): PlanProposal<SchedulingInstruction> {
  return {
    instructions: [
      {
        kind: 'ScheduleBooking',
        bookingId: bookingId(id),
        resourceId: resourceId('or-1'),
        subjectId: 'patient-1',
        startAt: isoTimestamp(startAt),
        endAt: isoTimestamp(endAt),
      },
    ],
    rationale: 'test proposal',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-22T00:00:00.000Z',
  };
}

function newShell() {
  return createInMemoryShell<SchedulingContext, SchedulingInstruction, SchedulingEffect>();
}

/**
 * Documents a real, currently-unguarded gap raised directly by a human
 * reviewer: `act()` never re-validates an already-computed `doOutcome`
 * against the shell's *actual* latest committed state before writing it —
 * `ImperativeShell` (shell.ts) has no "read latest state" method at all,
 * and `ActInput.doOutcome` is just trusted as-is. Both proposals below have
 * their Do stage computed against the same starting snapshot
 * (`emptyContext`), exactly what happens if proposal B's entire
 * Plan-Do-Check-Approve pipeline runs to completion while proposal A is
 * still sitting in someone's approval queue — a gap that can span hours.
 * Neither Do computation can see the other's effect, so scheduling's own
 * overlap-feasibility check (`findConflicts`) finds nothing wrong with
 * either one *in isolation* — the invariant genuinely holds within each
 * proposal's own view, and still fails once both reach `act()`.
 *
 * This test asserts the *current*, broken behavior (it passes today,
 * without any fix) specifically to make the gap concrete before deciding
 * how to close it — the same "prove it empirically first" discipline
 * `conservation.guard.test.ts` and `feasibility.guard.test.ts` already
 * apply to their own invariants.
 */
describe('act() commits a stale doOutcome without re-checking the shell\'s actual latest state', () => {
  it('a booking that already committed gets silently erased by a second commit computed from the same stale snapshot', () => {
    const shell = newShell();

    const proposalA = bookingProposal('booking-a', '2026-07-22T09:00:00.000Z', '2026-07-22T10:00:00.000Z');
    const proposalB = bookingProposal('booking-b', '2026-07-22T09:30:00.000Z', '2026-07-22T10:30:00.000Z');

    // Both Do stages run against the *same* starting snapshot — neither
    // sees the other's booking, exactly as if both were computed before
    // either had committed.
    const doOutcomeA = schedulingEngine.executeSequence(emptyContext, proposalA.instructions);
    const doOutcomeB = schedulingEngine.executeSequence(emptyContext, proposalB.instructions);
    expect(doOutcomeA.ok).toBe(true);
    expect(doOutcomeB.ok).toBe(true);

    const outcomeA = act(shell, {
      proposal: proposalA,
      doOutcome: doOutcomeA,
      decision: { kind: 'accept' },
      recordedAt: '2026-07-22T00:00:01.000Z',
    });
    expect(outcomeA).toBe('committed');
    expect(shell.commits[0]!.context.bookings['booking-a']).toBeDefined();

    // Proposal B commits using the doOutcome it computed *before* A ever
    // committed — act() has no way to know the world moved on, and
    // nothing here recomputes Do against the shell's now-current state.
    const outcomeB = act(shell, {
      proposal: proposalB,
      doOutcome: doOutcomeB,
      decision: { kind: 'accept' },
      recordedAt: '2026-07-22T00:00:02.000Z',
    });
    expect(outcomeB).toBe('committed');

    const latest = shell.commits[shell.commits.length - 1]!.context;

    // The bug: both act() calls report 'committed', both audit records say
    // so, but the persisted state after B's commit no longer contains A's
    // booking at all — not "two overlapping bookings now coexist" (which
    // would itself violate the feasibility invariant) but something worse:
    // A's already-committed data is gone, silently overwritten by B's
    // context, which was computed from a snapshot that never had A's
    // booking in it to begin with.
    expect(latest.bookings['booking-a']).toBeUndefined();
    expect(latest.bookings['booking-b']).toBeDefined();
    expect(shell.auditLog[0]).toMatchObject({ commitOutcome: 'committed' });
    expect(shell.auditLog[1]).toMatchObject({ commitOutcome: 'committed' });
  });
});
