import { describe, expect, it } from 'vitest';
import { recordSoapNoteHandler } from '../../../src/instructions/outpatient/handlers/recordSoapNote.js';
import { encounterId, isoTimestamp, patientId, soapNoteId, staffId } from '../../../src/instructions/outpatient/ids.js';
import type { OutpatientContext } from '../../../src/instructions/outpatient/types.js';

function checkedInContext(): OutpatientContext {
  return {
    encounters: {
      'encounter-1': {
        encounterId: encounterId('encounter-1'),
        patientId: patientId('patient-1'),
        status: 'checked-in',
        checkedInAt: isoTimestamp('2026-10-17T09:00:00.000Z'),
      },
    },
    soapNotes: {},
    cpoeOrders: {},
  };
}

function recordInstruction() {
  return {
    kind: 'RecordSoapNote' as const,
    noteId: soapNoteId('note-1'),
    encounterId: encounterId('encounter-1'),
    authorStaffId: staffId('staff-1'),
    subjective: 'Sore throat for 3 days.',
    objective: 'Temp 37.8C, pharyngeal erythema.',
    assessment: 'Acute pharyngitis.',
    plan: 'Supportive care, follow up if worsening.',
    recordedAt: isoTimestamp('2026-10-17T09:10:00.000Z'),
  };
}

describe('recordSoapNoteHandler', () => {
  it('records a draft SOAP note against a checked-in encounter and emits SoapNoteRecorded', () => {
    const result = recordSoapNoteHandler(checkedInContext(), recordInstruction());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.soapNotes['note-1']).toEqual({
      noteId: 'note-1',
      encounterId: 'encounter-1',
      authorStaffId: 'staff-1',
      subjective: 'Sore throat for 3 days.',
      objective: 'Temp 37.8C, pharyngeal erythema.',
      assessment: 'Acute pharyngitis.',
      plan: 'Supportive care, follow up if worsening.',
      status: 'draft',
      recordedAt: '2026-10-17T09:10:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'SoapNoteRecorded', noteId: 'note-1', encounterId: 'encounter-1', recordedAt: '2026-10-17T09:10:00.000Z' },
    ]);
  });

  it('rejects a note id that already exists', () => {
    const context = checkedInContext();
    const first = recordSoapNoteHandler(context, recordInstruction());
    if (!first.ok) throw new Error('expected first record to succeed');

    const second = recordSoapNoteHandler(first.value.context, recordInstruction());

    expect(second).toEqual({ ok: false, error: { kind: 'SoapNoteAlreadyExists', noteId: 'note-1' } });
  });

  it('rejects recording against an unknown encounter', () => {
    const result = recordSoapNoteHandler(
      { encounters: {}, soapNotes: {}, cpoeOrders: {} },
      recordInstruction(),
    );

    expect(result).toEqual({ ok: false, error: { kind: 'EncounterNotFound', encounterId: 'encounter-1' } });
  });

  it('rejects recording against an encounter that is already completed', () => {
    const context: OutpatientContext = {
      ...checkedInContext(),
      encounters: {
        'encounter-1': {
          encounterId: encounterId('encounter-1'),
          patientId: patientId('patient-1'),
          status: 'completed',
          checkedInAt: isoTimestamp('2026-10-17T09:00:00.000Z'),
          completedAt: isoTimestamp('2026-10-17T10:00:00.000Z'),
        },
      },
    };

    const result = recordSoapNoteHandler(context, recordInstruction());

    expect(result).toEqual({ ok: false, error: { kind: 'EncounterNotCheckedIn', encounterId: 'encounter-1' } });
  });
});
