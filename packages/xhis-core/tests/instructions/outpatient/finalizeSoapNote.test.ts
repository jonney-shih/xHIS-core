import { describe, expect, it } from 'vitest';
import { finalizeSoapNoteHandler } from '../../../src/instructions/outpatient/handlers/finalizeSoapNote.js';
import { encounterId, isoTimestamp, soapNoteId, staffId } from '../../../src/instructions/outpatient/ids.js';
import type { OutpatientContext } from '../../../src/instructions/outpatient/types.js';

function draftNoteContext(): OutpatientContext {
  return {
    encounters: {},
    soapNotes: {
      'note-1': {
        noteId: soapNoteId('note-1'),
        encounterId: encounterId('encounter-1'),
        authorStaffId: staffId('staff-1'),
        subjective: 's',
        objective: 'o',
        assessment: 'a',
        plan: 'p',
        status: 'draft',
        recordedAt: isoTimestamp('2026-10-17T09:10:00.000Z'),
      },
    },
    cpoeOrders: {},
  };
}

describe('finalizeSoapNoteHandler', () => {
  it('finalizes a draft note and emits SoapNoteFinalized', () => {
    const result = finalizeSoapNoteHandler(draftNoteContext(), {
      kind: 'FinalizeSoapNote',
      noteId: soapNoteId('note-1'),
      finalizedAt: isoTimestamp('2026-10-17T09:30:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.soapNotes['note-1']).toEqual({
      noteId: 'note-1',
      encounterId: 'encounter-1',
      authorStaffId: 'staff-1',
      subjective: 's',
      objective: 'o',
      assessment: 'a',
      plan: 'p',
      status: 'finalized',
      recordedAt: '2026-10-17T09:10:00.000Z',
      finalizedAt: '2026-10-17T09:30:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'SoapNoteFinalized', noteId: 'note-1', encounterId: 'encounter-1', finalizedAt: '2026-10-17T09:30:00.000Z' },
    ]);
  });

  it('rejects finalizing an unknown note', () => {
    const result = finalizeSoapNoteHandler(
      { encounters: {}, soapNotes: {}, cpoeOrders: {} },
      { kind: 'FinalizeSoapNote', noteId: soapNoteId('missing'), finalizedAt: isoTimestamp('2026-10-17T09:30:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'SoapNoteNotFound', noteId: 'missing' } });
  });

  it('rejects finalizing an already-finalized note', () => {
    const context = draftNoteContext();
    const first = finalizeSoapNoteHandler(context, {
      kind: 'FinalizeSoapNote',
      noteId: soapNoteId('note-1'),
      finalizedAt: isoTimestamp('2026-10-17T09:30:00.000Z'),
    });
    if (!first.ok) throw new Error('expected first finalize to succeed');

    const second = finalizeSoapNoteHandler(first.value.context, {
      kind: 'FinalizeSoapNote',
      noteId: soapNoteId('note-1'),
      finalizedAt: isoTimestamp('2026-10-17T09:31:00.000Z'),
    });

    expect(second).toEqual({ ok: false, error: { kind: 'SoapNoteAlreadyFinalized', noteId: 'note-1' } });
  });
});
