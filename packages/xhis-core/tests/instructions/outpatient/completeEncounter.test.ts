import { describe, expect, it } from 'vitest';
import { completeEncounterHandler } from '../../../src/instructions/outpatient/handlers/completeEncounter.js';
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

function withNote(context: OutpatientContext, status: 'draft' | 'finalized'): OutpatientContext {
  return {
    ...context,
    soapNotes: {
      'note-1': {
        noteId: soapNoteId('note-1'),
        encounterId: encounterId('encounter-1'),
        authorStaffId: staffId('staff-1'),
        subjective: 's',
        objective: 'o',
        assessment: 'a',
        plan: 'p',
        status,
        recordedAt: isoTimestamp('2026-10-17T09:10:00.000Z'),
        ...(status === 'finalized' ? { finalizedAt: isoTimestamp('2026-10-17T09:30:00.000Z') } : {}),
      },
    },
  };
}

describe('completeEncounterHandler', () => {
  it('completes an encounter that has a finalized SOAP note, and emits EncounterCompleted', () => {
    const context = withNote(checkedInContext(), 'finalized');

    const result = completeEncounterHandler(context, {
      kind: 'CompleteEncounter',
      encounterId: encounterId('encounter-1'),
      completedAt: isoTimestamp('2026-10-17T10:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.encounters['encounter-1']).toEqual({
      encounterId: 'encounter-1',
      patientId: 'patient-1',
      status: 'completed',
      checkedInAt: '2026-10-17T09:00:00.000Z',
      completedAt: '2026-10-17T10:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'EncounterCompleted', encounterId: 'encounter-1', completedAt: '2026-10-17T10:00:00.000Z' },
    ]);
  });

  it('rejects completing an unknown encounter', () => {
    const result = completeEncounterHandler(
      { encounters: {}, soapNotes: {}, cpoeOrders: {} },
      { kind: 'CompleteEncounter', encounterId: encounterId('missing'), completedAt: isoTimestamp('2026-10-17T10:00:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'EncounterNotFound', encounterId: 'missing' } });
  });

  it('rejects completing an already-completed encounter', () => {
    const context = withNote(checkedInContext(), 'finalized');
    const first = completeEncounterHandler(context, {
      kind: 'CompleteEncounter',
      encounterId: encounterId('encounter-1'),
      completedAt: isoTimestamp('2026-10-17T10:00:00.000Z'),
    });
    if (!first.ok) throw new Error('expected first completion to succeed');

    const second = completeEncounterHandler(first.value.context, {
      kind: 'CompleteEncounter',
      encounterId: encounterId('encounter-1'),
      completedAt: isoTimestamp('2026-10-17T10:05:00.000Z'),
    });

    expect(second).toEqual({ ok: false, error: { kind: 'EncounterNotCheckedIn', encounterId: 'encounter-1' } });
  });

  it('rejects completing an encounter with no SOAP notes at all', () => {
    const result = completeEncounterHandler(checkedInContext(), {
      kind: 'CompleteEncounter',
      encounterId: encounterId('encounter-1'),
      completedAt: isoTimestamp('2026-10-17T10:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'NoFinalizedSoapNote', encounterId: 'encounter-1' } });
  });

  it('rejects completing an encounter whose only SOAP note is still a draft -- the gating invariant this domain exists to prove', () => {
    const context = withNote(checkedInContext(), 'draft');

    const result = completeEncounterHandler(context, {
      kind: 'CompleteEncounter',
      encounterId: encounterId('encounter-1'),
      completedAt: isoTimestamp('2026-10-17T10:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'NoFinalizedSoapNote', encounterId: 'encounter-1' } });
  });
});
