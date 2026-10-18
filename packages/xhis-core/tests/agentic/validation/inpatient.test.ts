import { describe, expect, it } from 'vitest';
import { inpatientInstructionValidators } from '../../../src/agentic/validation/inpatient.js';
import { validateInstruction } from '../../../src/agentic/validation/validator.js';

describe('inpatientInstructionValidators', () => {
  it('accepts a well-formed AssignWard candidate', () => {
    const result = validateInstruction(inpatientInstructionValidators, {
      kind: 'AssignWard',
      assignmentId: 'assignment-1',
      encounterId: 'encounter-1',
      ward: '5B',
      attendingStaffId: 'dr-lin',
      assignedAt: '2026-10-18T09:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'AssignWard', assignmentId: 'assignment-1', encounterId: 'encounter-1', ward: '5B', attendingStaffId: 'dr-lin', assignedAt: '2026-10-18T09:00:00.000Z' },
    });
  });

  it('accepts a well-formed TransferWard candidate', () => {
    const result = validateInstruction(inpatientInstructionValidators, {
      kind: 'TransferWard',
      newAssignmentId: 'assignment-2',
      encounterId: 'encounter-1',
      ward: '6A',
      attendingStaffId: 'dr-wu',
      transferredAt: '2026-10-18T11:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'TransferWard', newAssignmentId: 'assignment-2', encounterId: 'encounter-1', ward: '6A', attendingStaffId: 'dr-wu', transferredAt: '2026-10-18T11:00:00.000Z' },
    });
  });

  it('accepts a well-formed RecordProgressNote candidate', () => {
    const result = validateInstruction(inpatientInstructionValidators, {
      kind: 'RecordProgressNote',
      noteId: 'note-1',
      assignmentId: 'assignment-1',
      authorStaffId: 'dr-lin',
      subjective: 's',
      objective: 'o',
      assessment: 'a',
      plan: 'p',
      recordedAt: '2026-10-18T10:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'RecordProgressNote',
        noteId: 'note-1',
        assignmentId: 'assignment-1',
        authorStaffId: 'dr-lin',
        subjective: 's',
        objective: 'o',
        assessment: 'a',
        plan: 'p',
        recordedAt: '2026-10-18T10:00:00.000Z',
      },
    });
  });

  it('accepts a well-formed FinalizeProgressNote candidate', () => {
    const result = validateInstruction(inpatientInstructionValidators, {
      kind: 'FinalizeProgressNote',
      noteId: 'note-1',
      finalizedAt: '2026-10-18T10:30:00.000Z',
    });

    expect(result).toEqual({ ok: true, value: { kind: 'FinalizeProgressNote', noteId: 'note-1', finalizedAt: '2026-10-18T10:30:00.000Z' } });
  });

  it('rejects an AssignWard candidate missing required fields, reporting every issue', () => {
    const result = validateInstruction(inpatientInstructionValidators, { kind: 'AssignWard', assignmentId: '' });

    expect(result).toEqual({
      ok: false,
      error: [
        "'assignmentId' must be a non-empty string",
        "'encounterId' must be a non-empty string",
        "'ward' must be a non-empty string",
        "'attendingStaffId' must be a non-empty string",
        "'assignedAt' must be an ISO-8601 timestamp string",
      ],
    });
  });

  it('rejects a timestamp that is not ISO-8601 shaped', () => {
    const result = validateInstruction(inpatientInstructionValidators, {
      kind: 'FinalizeProgressNote',
      noteId: 'note-1',
      finalizedAt: 'yesterday',
    });

    expect(result).toEqual({ ok: false, error: ["'finalizedAt' must be an ISO-8601 timestamp string"] });
  });

  it('rejects an unknown instruction kind', () => {
    const result = validateInstruction(inpatientInstructionValidators, { kind: 'DischargeFromWard', assignmentId: 'assignment-1' });

    expect(result).toEqual({ ok: false, error: ["unknown instruction kind 'DischargeFromWard'"] });
  });
});
