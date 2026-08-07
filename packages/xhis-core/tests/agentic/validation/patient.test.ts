import { describe, expect, it } from 'vitest';
import { validateInstruction } from '../../../src/agentic/validation/validator.js';
import { patientInstructionValidators } from '../../../src/agentic/validation/patient.js';

describe('patientInstructionValidators', () => {
  it('accepts a well-formed AdmitPatient candidate and brands its fields', () => {
    const result = validateInstruction(patientInstructionValidators, {
      kind: 'AdmitPatient',
      patientId: 'patient-1',
      encounterId: 'encounter-1',
      admittedAt: '2026-07-18T00:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'AdmitPatient',
        patientId: 'patient-1',
        encounterId: 'encounter-1',
        admittedAt: '2026-07-18T00:00:00.000Z',
      },
    });
  });

  it('accepts a well-formed DischargePatient candidate', () => {
    const result = validateInstruction(patientInstructionValidators, {
      kind: 'DischargePatient',
      encounterId: 'encounter-1',
      dischargedAt: '2026-07-18T01:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'DischargePatient',
        encounterId: 'encounter-1',
        dischargedAt: '2026-07-18T01:00:00.000Z',
      },
    });
  });

  it('rejects a candidate missing required fields, reporting every issue', () => {
    const result = validateInstruction(patientInstructionValidators, {
      kind: 'AdmitPatient',
      patientId: '',
    });

    expect(result).toEqual({
      ok: false,
      error: [
        "'patientId' must be a non-empty string",
        "'encounterId' must be a non-empty string",
        "'admittedAt' must be an ISO-8601 timestamp string",
      ],
    });
  });

  it('rejects a timestamp that is not ISO-8601 shaped', () => {
    const result = validateInstruction(patientInstructionValidators, {
      kind: 'DischargePatient',
      encounterId: 'encounter-1',
      dischargedAt: 'yesterday',
    });

    expect(result).toEqual({
      ok: false,
      error: ["'dischargedAt' must be an ISO-8601 timestamp string"],
    });
  });

  it('rejects an unknown instruction kind', () => {
    const result = validateInstruction(patientInstructionValidators, {
      kind: 'PrescribeMedication',
      drug: 'anything',
    });

    expect(result).toEqual({ ok: false, error: ["unknown instruction kind 'PrescribeMedication'"] });
  });

  it('rejects a non-object candidate', () => {
    expect(validateInstruction(patientInstructionValidators, 'AdmitPatient')).toEqual({
      ok: false,
      error: ['expected an instruction object'],
    });
    expect(validateInstruction(patientInstructionValidators, null)).toEqual({
      ok: false,
      error: ['expected an instruction object'],
    });
    expect(validateInstruction(patientInstructionValidators, ['AdmitPatient'])).toEqual({
      ok: false,
      error: ['expected an instruction object'],
    });
  });

  it('rejects a candidate with a non-string kind', () => {
    expect(validateInstruction(patientInstructionValidators, { kind: 1 })).toEqual({
      ok: false,
      error: ["expected a string 'kind' field"],
    });
  });
});
