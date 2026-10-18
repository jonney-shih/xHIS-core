import { describe, expect, it } from 'vitest';
import { emergencyInstructionValidators } from '../../../src/agentic/validation/emergency.js';
import { validateInstruction } from '../../../src/agentic/validation/validator.js';

describe('emergencyInstructionValidators', () => {
  it('accepts a well-formed RegisterEdVisit candidate', () => {
    const result = validateInstruction(emergencyInstructionValidators, {
      kind: 'RegisterEdVisit',
      visitId: 'visit-1',
      encounterId: 'encounter-1',
      patientId: 'patient-1',
      chiefComplaint: 'Chest pain',
      registeredAt: '2026-10-18T14:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'RegisterEdVisit', visitId: 'visit-1', encounterId: 'encounter-1', patientId: 'patient-1', chiefComplaint: 'Chest pain', registeredAt: '2026-10-18T14:00:00.000Z' },
    });
  });

  it.each([1, 2, 3, 4, 5])('accepts a well-formed TriagePatient candidate at ESI level %i', (esiLevel) => {
    const result = validateInstruction(emergencyInstructionValidators, {
      kind: 'TriagePatient',
      visitId: 'visit-1',
      esiLevel,
      triagedAt: '2026-10-18T14:05:00.000Z',
    });

    expect(result).toEqual({ ok: true, value: { kind: 'TriagePatient', visitId: 'visit-1', esiLevel, triagedAt: '2026-10-18T14:05:00.000Z' } });
  });

  it('rejects a TriagePatient candidate with an out-of-range esiLevel', () => {
    const result = validateInstruction(emergencyInstructionValidators, {
      kind: 'TriagePatient',
      visitId: 'visit-1',
      esiLevel: 6,
      triagedAt: '2026-10-18T14:05:00.000Z',
    });

    expect(result).toEqual({ ok: false, error: ["'esiLevel' must be one of 1, 2, 3, 4, 5"] });
  });

  it.each(['admitted', 'discharged', 'transferred', 'left-without-being-seen'])(
    'accepts a well-formed DispositionPatient candidate with disposition %s',
    (disposition) => {
      const result = validateInstruction(emergencyInstructionValidators, {
        kind: 'DispositionPatient',
        visitId: 'visit-1',
        disposition,
        dispositionedAt: '2026-10-18T15:00:00.000Z',
      });

      expect(result).toEqual({ ok: true, value: { kind: 'DispositionPatient', visitId: 'visit-1', disposition, dispositionedAt: '2026-10-18T15:00:00.000Z' } });
    },
  );

  it('rejects a DispositionPatient candidate with an unknown disposition value', () => {
    const result = validateInstruction(emergencyInstructionValidators, {
      kind: 'DispositionPatient',
      visitId: 'visit-1',
      disposition: 'eloped',
      dispositionedAt: '2026-10-18T15:00:00.000Z',
    });

    expect(result).toEqual({ ok: false, error: ["'disposition' must be one of 'admitted', 'discharged', 'transferred', 'left-without-being-seen'"] });
  });

  it('rejects a candidate missing required fields, reporting every issue', () => {
    const result = validateInstruction(emergencyInstructionValidators, { kind: 'RegisterEdVisit', visitId: '' });

    expect(result).toEqual({
      ok: false,
      error: [
        "'visitId' must be a non-empty string",
        "'encounterId' must be a non-empty string",
        "'patientId' must be a non-empty string",
        "'chiefComplaint' must be a non-empty string",
        "'registeredAt' must be an ISO-8601 timestamp string",
      ],
    });
  });

  it('rejects an unknown instruction kind', () => {
    const result = validateInstruction(emergencyInstructionValidators, { kind: 'ReopenEdVisit', visitId: 'visit-1' });

    expect(result).toEqual({ ok: false, error: ["unknown instruction kind 'ReopenEdVisit'"] });
  });
});
