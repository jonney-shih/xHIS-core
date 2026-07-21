import { describe, expect, it } from 'vitest';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { schedulingEngine } from '../../../src/instructions/scheduling/engine.js';
import { bookingId, isoTimestamp, resourceId } from '../../../src/instructions/scheduling/ids.js';
import type { SchedulingContext, SchedulingEffect, SchedulingInstruction } from '../../../src/instructions/scheduling/types.js';

const emptyContext: SchedulingContext = { bookings: {} };

function bookingProposal(id: string, resource: string, startAt: string, endAt: string): PlanProposal<SchedulingInstruction> {
  return {
    instructions: [
      {
        kind: 'ScheduleBooking',
        bookingId: bookingId(id),
        resourceId: resourceId(resource),
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

function reexecuteOf(proposal: PlanProposal<SchedulingInstruction>) {
  return (ctx: SchedulingContext) => schedulingEngine.executeSequence(ctx, proposal.instructions);
}

/**
 * Originally documented a real, then-unguarded gap raised directly by a
 * human reviewer: `act()` used to commit an already-computed `doOutcome`
 * without ever re-checking it against the shell's *actual* latest state.
 * Now that `act()` re-derives the effect to commit via `reexecute` against
 * `shell.readLatest()` (see `act.ts`), this file proves the fix closes the
 * race rather than merely describing it.
 */
describe('act() re-validates a stale doOutcome against the shell\'s actual latest state before committing', () => {
  it('a second proposal computed from the same stale snapshot is rejected as stale, not silently committed over the first', () => {
    const shell = newShell();

    const proposalA = bookingProposal('booking-a', 'or-1', '2026-07-22T09:00:00.000Z', '2026-07-22T10:00:00.000Z');
    const proposalB = bookingProposal('booking-b', 'or-1', '2026-07-22T09:30:00.000Z', '2026-07-22T10:30:00.000Z');

    // Both Do stages run against the *same* starting snapshot — neither
    // sees the other's booking, exactly as if both were computed before
    // either had committed (e.g. one sat in a human approver's queue
    // while the other's pipeline ran to completion).
    const doOutcomeA = schedulingEngine.executeSequence(emptyContext, proposalA.instructions);
    const doOutcomeB = schedulingEngine.executeSequence(emptyContext, proposalB.instructions);
    expect(doOutcomeA.ok).toBe(true);
    expect(doOutcomeB.ok).toBe(true);

    const outcomeA = act(shell, {
      proposal: proposalA,
      doOutcome: doOutcomeA,
      decision: { kind: 'accept' },
      baselineContext: emptyContext,
      reexecute: reexecuteOf(proposalA),
      recordedAt: '2026-07-22T00:00:01.000Z',
    });
    expect(outcomeA).toBe('committed');
    expect(shell.commits[0]!.context.bookings['booking-a']).toBeDefined();

    // Proposal B still carries the doOutcome it computed *before* A ever
    // committed, but act() no longer trusts that blindly: it re-runs Do
    // against shell.readLatest() (which now has A's booking) right before
    // writing. The overlapping booking-b conflicts with the now-visible
    // booking-a, so re-validation fails.
    const outcomeB = act(shell, {
      proposal: proposalB,
      doOutcome: doOutcomeB,
      decision: { kind: 'accept' },
      baselineContext: emptyContext,
      reexecute: reexecuteOf(proposalB),
      recordedAt: '2026-07-22T00:00:02.000Z',
    });

    expect(outcomeB).toBe('stale');
    expect(shell.commits).toHaveLength(1);

    const latest = shell.commits[shell.commits.length - 1]!.context;
    expect(latest.bookings['booking-a']).toBeDefined();
    expect(latest.bookings['booking-b']).toBeUndefined();
    expect(shell.auditLog[0]).toMatchObject({ commitOutcome: 'committed' });
    expect(shell.auditLog[1]).toMatchObject({ commitOutcome: 'stale' });
    expect(shell.auditLog[1]!.reasons[0]).toContain('re-validation against the latest committed state failed');
  });

  it('a second proposal that does not actually conflict still commits, using the freshly recomputed state rather than the stale one', () => {
    const shell = newShell();

    const proposalA = bookingProposal('booking-a', 'or-1', '2026-07-22T09:00:00.000Z', '2026-07-22T10:00:00.000Z');
    // Different resource — genuinely no conflict with A, even though C's
    // own Do also ran against the same pre-A snapshot.
    const proposalC = bookingProposal('booking-c', 'or-2', '2026-07-22T09:00:00.000Z', '2026-07-22T10:00:00.000Z');

    const doOutcomeA = schedulingEngine.executeSequence(emptyContext, proposalA.instructions);
    const doOutcomeC = schedulingEngine.executeSequence(emptyContext, proposalC.instructions);

    act(shell, {
      proposal: proposalA,
      doOutcome: doOutcomeA,
      decision: { kind: 'accept' },
      baselineContext: emptyContext,
      reexecute: reexecuteOf(proposalA),
      recordedAt: '2026-07-22T00:00:01.000Z',
    });

    const outcomeC = act(shell, {
      proposal: proposalC,
      doOutcome: doOutcomeC,
      decision: { kind: 'accept' },
      baselineContext: emptyContext,
      reexecute: reexecuteOf(proposalC),
      recordedAt: '2026-07-22T00:00:02.000Z',
    });

    expect(outcomeC).toBe('committed');

    // The critical assertion: the committed context contains *both*
    // bookings, because the fresh re-check recomputed C's effect against
    // the shell's real latest state (which already had A in it) — not
    // C's own stale doOutcome, which alone would only ever have had
    // booking-c and would have erased booking-a on write.
    const latest = shell.commits[shell.commits.length - 1]!.context;
    expect(latest.bookings['booking-a']).toBeDefined();
    expect(latest.bookings['booking-c']).toBeDefined();
  });
});
