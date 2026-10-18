import { describe, expect, it } from 'vitest';
import { transferWardHandler } from '../../../src/instructions/inpatient/handlers/transferWard.js';
import { encounterId, isoTimestamp, progressNoteId, staffId, wardAssignmentId } from '../../../src/instructions/inpatient/ids.js';
import type { InpatientContext } from '../../../src/instructions/inpatient/types.js';

function activeAssignmentContext(): InpatientContext {
  return {
    wardAssignments: {
      'assignment-1': {
        assignmentId: wardAssignmentId('assignment-1'),
        encounterId: encounterId('encounter-1'),
        ward: '5B',
        attendingStaffId: staffId('dr-lin'),
        status: 'active',
        assignedAt: isoTimestamp('2026-10-18T09:00:00.000Z'),
      },
    },
    progressNotes: {},
  };
}

function withNoteFor(context: InpatientContext, assignmentId: string, status: 'draft' | 'finalized'): InpatientContext {
  return {
    ...context,
    progressNotes: {
      ...context.progressNotes,
      [`note-for-${assignmentId}`]: {
        noteId: progressNoteId(`note-for-${assignmentId}`),
        assignmentId: wardAssignmentId(assignmentId),
        authorStaffId: staffId('dr-lin'),
        subjective: 's',
        objective: 'o',
        assessment: 'a',
        plan: 'p',
        status,
        recordedAt: isoTimestamp('2026-10-18T10:00:00.000Z'),
        ...(status === 'finalized' ? { finalizedAt: isoTimestamp('2026-10-18T10:30:00.000Z') } : {}),
      },
    },
  };
}

function transferInstruction() {
  return {
    kind: 'TransferWard' as const,
    newAssignmentId: wardAssignmentId('assignment-2'),
    encounterId: encounterId('encounter-1'),
    ward: '6A',
    attendingStaffId: staffId('dr-wu'),
    transferredAt: isoTimestamp('2026-10-18T11:00:00.000Z'),
  };
}

describe('transferWardHandler', () => {
  it('ends the current assignment and starts a new one, emitting both effects, once the current assignment has a finalized note', () => {
    const context = withNoteFor(activeAssignmentContext(), 'assignment-1', 'finalized');

    const result = transferWardHandler(context, transferInstruction());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.wardAssignments['assignment-1']).toMatchObject({ status: 'ended', endedAt: '2026-10-18T11:00:00.000Z' });
    expect(result.value.context.wardAssignments['assignment-2']).toEqual({
      assignmentId: 'assignment-2',
      encounterId: 'encounter-1',
      ward: '6A',
      attendingStaffId: 'dr-wu',
      status: 'active',
      assignedAt: '2026-10-18T11:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'WardAssignmentEnded', assignmentId: 'assignment-1', encounterId: 'encounter-1', endedAt: '2026-10-18T11:00:00.000Z' },
      { kind: 'WardAssigned', assignmentId: 'assignment-2', encounterId: 'encounter-1', ward: '6A', attendingStaffId: 'dr-wu', assignedAt: '2026-10-18T11:00:00.000Z' },
    ]);
  });

  it('rejects a new assignment id that already exists', () => {
    const context = withNoteFor(activeAssignmentContext(), 'assignment-1', 'finalized');
    const preExisting: InpatientContext = {
      ...context,
      wardAssignments: {
        ...context.wardAssignments,
        'assignment-2': {
          assignmentId: wardAssignmentId('assignment-2'),
          encounterId: encounterId('encounter-9'),
          ward: 'ICU',
          attendingStaffId: staffId('dr-chen'),
          status: 'ended',
          assignedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
          endedAt: isoTimestamp('2026-01-02T00:00:00.000Z'),
        },
      },
    };

    const result = transferWardHandler(preExisting, transferInstruction());

    expect(result).toEqual({ ok: false, error: { kind: 'WardAssignmentAlreadyExists', assignmentId: 'assignment-2' } });
  });

  it('rejects transferring an encounter with no active ward assignment at all', () => {
    const result = transferWardHandler({ wardAssignments: {}, progressNotes: {} }, transferInstruction());

    expect(result).toEqual({ ok: false, error: { kind: 'EncounterHasNoActiveWardAssignment', encounterId: 'encounter-1' } });
  });

  it('rejects transferring when the current assignment has no progress note at all', () => {
    const result = transferWardHandler(activeAssignmentContext(), transferInstruction());

    expect(result).toEqual({ ok: false, error: { kind: 'NoFinalizedProgressNoteForCurrentAssignment', assignmentId: 'assignment-1' } });
  });

  it('rejects transferring when the current assignment only has a draft progress note', () => {
    const context = withNoteFor(activeAssignmentContext(), 'assignment-1', 'draft');

    const result = transferWardHandler(context, transferInstruction());

    expect(result).toEqual({ ok: false, error: { kind: 'NoFinalizedProgressNoteForCurrentAssignment', assignmentId: 'assignment-1' } });
  });

  it('the gating invariant is scoped per assignment, not per encounter: a finalized note from an earlier, already-ended assignment does not authorize a second transfer', () => {
    const firstContext = withNoteFor(activeAssignmentContext(), 'assignment-1', 'finalized');
    const firstTransfer = transferWardHandler(firstContext, transferInstruction());
    if (!firstTransfer.ok) throw new Error('expected first transfer to succeed');

    // assignment-1 is now 'ended' with a finalized note; assignment-2 is
    // the new active assignment and has no note of its own yet.
    const secondTransferInstruction = {
      kind: 'TransferWard' as const,
      newAssignmentId: wardAssignmentId('assignment-3'),
      encounterId: encounterId('encounter-1'),
      ward: '7C',
      attendingStaffId: staffId('dr-huang'),
      transferredAt: isoTimestamp('2026-10-18T12:00:00.000Z'),
    };

    const secondTransfer = transferWardHandler(firstTransfer.value.context, secondTransferInstruction);

    expect(secondTransfer).toEqual({ ok: false, error: { kind: 'NoFinalizedProgressNoteForCurrentAssignment', assignmentId: 'assignment-2' } });
  });
});
