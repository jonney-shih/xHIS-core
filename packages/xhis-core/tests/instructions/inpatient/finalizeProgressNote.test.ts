import { describe, expect, it } from 'vitest';
import { finalizeProgressNoteHandler } from '../../../src/instructions/inpatient/handlers/finalizeProgressNote.js';
import { isoTimestamp, progressNoteId, staffId, wardAssignmentId } from '../../../src/instructions/inpatient/ids.js';
import type { InpatientContext } from '../../../src/instructions/inpatient/types.js';

function draftNoteContext(): InpatientContext {
  return {
    wardAssignments: {},
    progressNotes: {
      'note-1': {
        noteId: progressNoteId('note-1'),
        assignmentId: wardAssignmentId('assignment-1'),
        authorStaffId: staffId('dr-lin'),
        subjective: 's',
        objective: 'o',
        assessment: 'a',
        plan: 'p',
        status: 'draft',
        recordedAt: isoTimestamp('2026-10-18T10:00:00.000Z'),
      },
    },
  };
}

describe('finalizeProgressNoteHandler', () => {
  it('finalizes a draft note and emits ProgressNoteFinalized', () => {
    const result = finalizeProgressNoteHandler(draftNoteContext(), {
      kind: 'FinalizeProgressNote',
      noteId: progressNoteId('note-1'),
      finalizedAt: isoTimestamp('2026-10-18T10:30:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.progressNotes['note-1']).toEqual({
      noteId: 'note-1',
      assignmentId: 'assignment-1',
      authorStaffId: 'dr-lin',
      subjective: 's',
      objective: 'o',
      assessment: 'a',
      plan: 'p',
      status: 'finalized',
      recordedAt: '2026-10-18T10:00:00.000Z',
      finalizedAt: '2026-10-18T10:30:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'ProgressNoteFinalized', noteId: 'note-1', assignmentId: 'assignment-1', finalizedAt: '2026-10-18T10:30:00.000Z' },
    ]);
  });

  it('rejects finalizing an unknown note', () => {
    const result = finalizeProgressNoteHandler(
      { wardAssignments: {}, progressNotes: {} },
      { kind: 'FinalizeProgressNote', noteId: progressNoteId('missing'), finalizedAt: isoTimestamp('2026-10-18T10:30:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'ProgressNoteNotFound', noteId: 'missing' } });
  });

  it('rejects finalizing an already-finalized note', () => {
    const context = draftNoteContext();
    const first = finalizeProgressNoteHandler(context, {
      kind: 'FinalizeProgressNote',
      noteId: progressNoteId('note-1'),
      finalizedAt: isoTimestamp('2026-10-18T10:30:00.000Z'),
    });
    if (!first.ok) throw new Error('expected first finalize to succeed');

    const second = finalizeProgressNoteHandler(first.value.context, {
      kind: 'FinalizeProgressNote',
      noteId: progressNoteId('note-1'),
      finalizedAt: isoTimestamp('2026-10-18T10:31:00.000Z'),
    });

    expect(second).toEqual({ ok: false, error: { kind: 'ProgressNoteAlreadyFinalized', noteId: 'note-1' } });
  });
});
