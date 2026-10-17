import { describe, expect, it } from 'vitest';
import { outpatientInstructionValidators } from '../../../src/agentic/validation/outpatient.js';
import { validateInstruction } from '../../../src/agentic/validation/validator.js';

describe('outpatientInstructionValidators', () => {
  it('accepts a well-formed CheckInPatient candidate', () => {
    const result = validateInstruction(outpatientInstructionValidators, {
      kind: 'CheckInPatient',
      encounterId: 'encounter-1',
      patientId: 'patient-1',
      checkedInAt: '2026-10-17T09:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'CheckInPatient', encounterId: 'encounter-1', patientId: 'patient-1', checkedInAt: '2026-10-17T09:00:00.000Z' },
    });
  });

  it('accepts a well-formed RecordSoapNote candidate', () => {
    const result = validateInstruction(outpatientInstructionValidators, {
      kind: 'RecordSoapNote',
      noteId: 'note-1',
      encounterId: 'encounter-1',
      authorStaffId: 'staff-1',
      subjective: 's',
      objective: 'o',
      assessment: 'a',
      plan: 'p',
      recordedAt: '2026-10-17T09:10:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'RecordSoapNote',
        noteId: 'note-1',
        encounterId: 'encounter-1',
        authorStaffId: 'staff-1',
        subjective: 's',
        objective: 'o',
        assessment: 'a',
        plan: 'p',
        recordedAt: '2026-10-17T09:10:00.000Z',
      },
    });
  });

  it('accepts a well-formed FinalizeSoapNote candidate', () => {
    const result = validateInstruction(outpatientInstructionValidators, {
      kind: 'FinalizeSoapNote',
      noteId: 'note-1',
      finalizedAt: '2026-10-17T09:30:00.000Z',
    });

    expect(result).toEqual({ ok: true, value: { kind: 'FinalizeSoapNote', noteId: 'note-1', finalizedAt: '2026-10-17T09:30:00.000Z' } });
  });

  it.each([
    { orderType: 'lab', testCode: 'CBC' },
    { orderType: 'imaging', modality: 'CT' },
    { orderType: 'pharmacy', medicationCode: 'AMOX500' },
  ])('accepts a well-formed PlaceCpoeOrder candidate with detail %j', (detail) => {
    const result = validateInstruction(outpatientInstructionValidators, {
      kind: 'PlaceCpoeOrder',
      orderId: 'order-1',
      encounterId: 'encounter-1',
      detail,
      placedAt: '2026-10-17T09:15:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'PlaceCpoeOrder', orderId: 'order-1', encounterId: 'encounter-1', detail, placedAt: '2026-10-17T09:15:00.000Z' },
    });
  });

  it('accepts a well-formed CompleteEncounter candidate', () => {
    const result = validateInstruction(outpatientInstructionValidators, {
      kind: 'CompleteEncounter',
      encounterId: 'encounter-1',
      completedAt: '2026-10-17T10:00:00.000Z',
    });

    expect(result).toEqual({ ok: true, value: { kind: 'CompleteEncounter', encounterId: 'encounter-1', completedAt: '2026-10-17T10:00:00.000Z' } });
  });

  it('rejects a CheckInPatient candidate missing required fields, reporting every issue', () => {
    const result = validateInstruction(outpatientInstructionValidators, { kind: 'CheckInPatient', encounterId: '' });

    expect(result).toEqual({
      ok: false,
      error: ["'encounterId' must be a non-empty string", "'patientId' must be a non-empty string", "'checkedInAt' must be an ISO-8601 timestamp string"],
    });
  });

  it('rejects a PlaceCpoeOrder candidate with a missing detail', () => {
    const result = validateInstruction(outpatientInstructionValidators, {
      kind: 'PlaceCpoeOrder',
      orderId: 'order-1',
      encounterId: 'encounter-1',
      placedAt: '2026-10-17T09:15:00.000Z',
    });

    expect(result).toEqual({
      ok: false,
      error: [
        "'detail' must be { orderType: 'lab', testCode: non-empty string } | { orderType: 'imaging', modality: non-empty string } | { orderType: 'pharmacy', medicationCode: non-empty string }",
      ],
    });
  });

  it('rejects a PlaceCpoeOrder candidate whose detail names an unknown orderType', () => {
    const result = validateInstruction(outpatientInstructionValidators, {
      kind: 'PlaceCpoeOrder',
      orderId: 'order-1',
      encounterId: 'encounter-1',
      detail: { orderType: 'surgery', procedureCode: 'APPX' },
      placedAt: '2026-10-17T09:15:00.000Z',
    });

    expect(result.ok).toBe(false);
  });

  it('rejects a PlaceCpoeOrder candidate whose detail is missing the field its own orderType requires', () => {
    const result = validateInstruction(outpatientInstructionValidators, {
      kind: 'PlaceCpoeOrder',
      orderId: 'order-1',
      encounterId: 'encounter-1',
      detail: { orderType: 'lab' },
      placedAt: '2026-10-17T09:15:00.000Z',
    });

    expect(result.ok).toBe(false);
  });

  it('rejects a timestamp that is not ISO-8601 shaped', () => {
    const result = validateInstruction(outpatientInstructionValidators, {
      kind: 'CompleteEncounter',
      encounterId: 'encounter-1',
      completedAt: 'yesterday',
    });

    expect(result).toEqual({ ok: false, error: ["'completedAt' must be an ISO-8601 timestamp string"] });
  });

  it('rejects an unknown instruction kind', () => {
    const result = validateInstruction(outpatientInstructionValidators, { kind: 'CancelCpoeOrder', orderId: 'order-1' });

    expect(result).toEqual({ ok: false, error: ["unknown instruction kind 'CancelCpoeOrder'"] });
  });
});
