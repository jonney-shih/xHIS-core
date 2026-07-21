import { describe, expect, it } from 'vitest';
import { bedInstructionValidators } from '../../../src/agentic/validation/bed.js';
import { validateInstruction } from '../../../src/agentic/validation/validator.js';

describe('bedInstructionValidators', () => {
  it('accepts a well-formed AssignBed candidate and brands its fields', () => {
    const result = validateInstruction(bedInstructionValidators, {
      kind: 'AssignBed',
      bedId: 'bed-1',
      encounterId: 'encounter-1',
      assignedAt: '2026-07-22T00:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'AssignBed',
        bedId: 'bed-1',
        encounterId: 'encounter-1',
        assignedAt: '2026-07-22T00:00:00.000Z',
      },
    });
  });

  it('accepts a well-formed ReleaseBed candidate', () => {
    const result = validateInstruction(bedInstructionValidators, {
      kind: 'ReleaseBed',
      bedId: 'bed-1',
      releasedAt: '2026-07-22T02:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'ReleaseBed', bedId: 'bed-1', releasedAt: '2026-07-22T02:00:00.000Z' },
    });
  });

  it('rejects a candidate missing required fields, reporting every issue', () => {
    const result = validateInstruction(bedInstructionValidators, {
      kind: 'AssignBed',
      bedId: '',
    });

    expect(result).toEqual({
      ok: false,
      error: ["'bedId' must be a non-empty string", "'encounterId' must be a non-empty string", "'assignedAt' must be an ISO-8601 timestamp string"],
    });
  });

  it('rejects a timestamp that is not ISO-8601 shaped', () => {
    const result = validateInstruction(bedInstructionValidators, {
      kind: 'ReleaseBed',
      bedId: 'bed-1',
      releasedAt: 'yesterday',
    });

    expect(result).toEqual({ ok: false, error: ["'releasedAt' must be an ISO-8601 timestamp string"] });
  });

  it('rejects an unknown instruction kind', () => {
    const result = validateInstruction(bedInstructionValidators, { kind: 'RelocateBed', bedId: 'bed-1' });

    expect(result).toEqual({ ok: false, error: ["unknown instruction kind 'RelocateBed'"] });
  });
});
