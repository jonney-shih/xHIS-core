import { describe, expect, it } from 'vitest';
import { recordProgressNoteHandler } from '../../../src/instructions/inpatient/handlers/recordProgressNote.js';
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

function recordInstruction() {
  return {
    kind: 'RecordProgressNote' as const,
    noteId: progressNoteId('note-1'),
    assignmentId: wardAssignmentId('assignment-1'),
    authorStaffId: staffId('dr-lin'),
    subjective: 'Feels better today.',
    objective: 'Afebrile, vitals stable.',
    assessment: 'Improving.',
    plan: 'Continue current treatment.',
    recordedAt: isoTimestamp('2026-10-18T10:00:00.000Z'),
  };
}

describe('recordProgressNoteHandler', () => {
  it('records a draft progress note against an active ward assignment and emits ProgressNoteRecorded', () => {
    const result = recordProgressNoteHandler(activeAssignmentContext(), recordInstruction());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.progressNotes['note-1']).toEqual({
      noteId: 'note-1',
      assignmentId: 'assignment-1',
      authorStaffId: 'dr-lin',
      subjective: 'Feels better today.',
      objective: 'Afebrile, vitals stable.',
      assessment: 'Improving.',
      plan: 'Continue current treatment.',
      status: 'draft',
      recordedAt: '2026-10-18T10:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'ProgressNoteRecorded', noteId: 'note-1', assignmentId: 'assignment-1', recordedAt: '2026-10-18T10:00:00.000Z' },
    ]);
  });

  it('rejects a note id that already exists', () => {
    const context = activeAssignmentContext();
    const first = recordProgressNoteHandler(context, recordInstruction());
    if (!first.ok) throw new Error('expected first record to succeed');

    const second = recordProgressNoteHandler(first.value.context, recordInstruction());

    expect(second).toEqual({ ok: false, error: { kind: 'ProgressNoteAlreadyExists', noteId: 'note-1' } });
  });

  it('rejects recording against an unknown ward assignment', () => {
    const result = recordProgressNoteHandler({ wardAssignments: {}, progressNotes: {} }, recordInstruction());

    expect(result).toEqual({ ok: false, error: { kind: 'WardAssignmentNotFound', assignmentId: 'assignment-1' } });
  });

  it('rejects recording against a ward assignment that has already ended', () => {
    const context: InpatientContext = {
      ...activeAssignmentContext(),
      wardAssignments: {
        'assignment-1': {
          assignmentId: wardAssignmentId('assignment-1'),
          encounterId: encounterId('encounter-1'),
          ward: '5B',
          attendingStaffId: staffId('dr-lin'),
          status: 'ended',
          assignedAt: isoTimestamp('2026-10-18T09:00:00.000Z'),
          endedAt: isoTimestamp('2026-10-18T09:30:00.000Z'),
        },
      },
    };

    const result = recordProgressNoteHandler(context, recordInstruction());

    expect(result).toEqual({ ok: false, error: { kind: 'WardAssignmentNotActive', assignmentId: 'assignment-1' } });
  });
});
