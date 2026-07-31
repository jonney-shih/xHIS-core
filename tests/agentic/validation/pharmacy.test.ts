import { describe, expect, it } from 'vitest';
import { pharmacyInstructionValidators } from '../../../src/agentic/validation/pharmacy.js';
import { validateInstruction } from '../../../src/agentic/validation/validator.js';

describe('pharmacyInstructionValidators', () => {
  it('accepts a well-formed PrescribeMedication candidate and brands its fields', () => {
    const result = validateInstruction(pharmacyInstructionValidators, {
      kind: 'PrescribeMedication',
      prescriptionId: 'rx-1',
      encounterId: 'encounter-1',
      medicationCode: 'AMOX-500',
      prescribedAt: '2026-07-31T00:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'PrescribeMedication',
        prescriptionId: 'rx-1',
        encounterId: 'encounter-1',
        medicationCode: 'AMOX-500',
        prescribedAt: '2026-07-31T00:00:00.000Z',
      },
    });
  });

  it('accepts a well-formed DispenseMedication candidate', () => {
    const result = validateInstruction(pharmacyInstructionValidators, {
      kind: 'DispenseMedication',
      prescriptionId: 'rx-1',
      dispensedAt: '2026-07-31T02:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'DispenseMedication', prescriptionId: 'rx-1', dispensedAt: '2026-07-31T02:00:00.000Z' },
    });
  });

  it('rejects a candidate missing required fields, reporting every issue', () => {
    const result = validateInstruction(pharmacyInstructionValidators, {
      kind: 'PrescribeMedication',
      prescriptionId: '',
    });

    expect(result).toEqual({
      ok: false,
      error: [
        "'prescriptionId' must be a non-empty string",
        "'encounterId' must be a non-empty string",
        "'medicationCode' must be a non-empty string",
        "'prescribedAt' must be an ISO-8601 timestamp string",
      ],
    });
  });

  it('rejects a timestamp that is not ISO-8601 shaped', () => {
    const result = validateInstruction(pharmacyInstructionValidators, {
      kind: 'DispenseMedication',
      prescriptionId: 'rx-1',
      dispensedAt: 'yesterday',
    });

    expect(result).toEqual({ ok: false, error: ["'dispensedAt' must be an ISO-8601 timestamp string"] });
  });

  it('rejects an unknown instruction kind', () => {
    const result = validateInstruction(pharmacyInstructionValidators, { kind: 'RefillMedication', prescriptionId: 'rx-1' });

    expect(result).toEqual({ ok: false, error: ["unknown instruction kind 'RefillMedication'"] });
  });
});
