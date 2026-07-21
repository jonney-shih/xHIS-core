import { describe, expect, it } from 'vitest';
import { imagingInstructionValidators } from '../../../src/agentic/validation/imaging.js';
import { validateInstruction } from '../../../src/agentic/validation/validator.js';

describe('imagingInstructionValidators', () => {
  it('accepts a well-formed OrderStudy candidate and brands its fields', () => {
    const result = validateInstruction(imagingInstructionValidators, {
      kind: 'OrderStudy',
      studyId: 'study-1',
      encounterId: 'encounter-1',
      modality: 'CT',
      orderedAt: '2026-07-22T00:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'OrderStudy',
        studyId: 'study-1',
        encounterId: 'encounter-1',
        modality: 'CT',
        orderedAt: '2026-07-22T00:00:00.000Z',
      },
    });
  });

  it('accepts a well-formed RecordStudyStored candidate', () => {
    const result = validateInstruction(imagingInstructionValidators, {
      kind: 'RecordStudyStored',
      studyId: 'study-1',
      storageRef: 'pacs://study-1',
      performedAt: '2026-07-22T00:30:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'RecordStudyStored', studyId: 'study-1', storageRef: 'pacs://study-1', performedAt: '2026-07-22T00:30:00.000Z' },
    });
  });

  it('accepts a well-formed ReportStudy candidate', () => {
    const result = validateInstruction(imagingInstructionValidators, {
      kind: 'ReportStudy',
      studyId: 'study-1',
      reportText: 'No acute findings.',
      reportedAt: '2026-07-22T01:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'ReportStudy', studyId: 'study-1', reportText: 'No acute findings.', reportedAt: '2026-07-22T01:00:00.000Z' },
    });
  });

  it('accepts a well-formed CancelStudy candidate', () => {
    const result = validateInstruction(imagingInstructionValidators, {
      kind: 'CancelStudy',
      studyId: 'study-1',
      cancelledAt: '2026-07-22T02:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'CancelStudy', studyId: 'study-1', cancelledAt: '2026-07-22T02:00:00.000Z' },
    });
  });

  it('rejects a candidate missing required fields, reporting every issue', () => {
    const result = validateInstruction(imagingInstructionValidators, {
      kind: 'OrderStudy',
      studyId: '',
    });

    expect(result).toEqual({
      ok: false,
      error: [
        "'studyId' must be a non-empty string",
        "'encounterId' must be a non-empty string",
        "'modality' must be a non-empty string",
        "'orderedAt' must be an ISO-8601 timestamp string",
      ],
    });
  });

  it('rejects a timestamp that is not ISO-8601 shaped', () => {
    const result = validateInstruction(imagingInstructionValidators, {
      kind: 'CancelStudy',
      studyId: 'study-1',
      cancelledAt: 'yesterday',
    });

    expect(result).toEqual({ ok: false, error: ["'cancelledAt' must be an ISO-8601 timestamp string"] });
  });

  it('rejects an unknown instruction kind', () => {
    const result = validateInstruction(imagingInstructionValidators, { kind: 'AmendReport', studyId: 'study-1' });

    expect(result).toEqual({ ok: false, error: ["unknown instruction kind 'AmendReport'"] });
  });
});
