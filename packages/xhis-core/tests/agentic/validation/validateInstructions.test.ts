import { describe, expect, it } from 'vitest';
import { patientInstructionValidators } from '../../../src/agentic/validation/patient.js';
import { validateInstructions } from '../../../src/agentic/validation/validator.js';

describe('validateInstructions', () => {
  it('accepts an empty batch', () => {
    expect(validateInstructions(patientInstructionValidators, [])).toEqual({ ok: true, value: [] });
  });

  it('accepts a batch where every candidate validates, in order', () => {
    const admit = { kind: 'AdmitPatient', patientId: 'p1', encounterId: 'e1', admittedAt: '2026-07-18T00:00:00.000Z' };
    const discharge = { kind: 'DischargePatient', encounterId: 'e1', dischargedAt: '2026-07-18T01:00:00.000Z' };

    const result = validateInstructions(patientInstructionValidators, [admit, discharge]);

    expect(result).toEqual({ ok: true, value: [admit, discharge] });
  });

  it('rejects the whole batch when any single candidate is invalid', () => {
    const admit = { kind: 'AdmitPatient', patientId: 'p1', encounterId: 'e1', admittedAt: '2026-07-18T00:00:00.000Z' };
    const badDischarge = { kind: 'DischargePatient', encounterId: 'e1' };

    const result = validateInstructions(patientInstructionValidators, [admit, badDischarge]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.error).toEqual([
      { index: 1, issues: ["'dischargedAt' must be an ISO-8601 timestamp string"] },
    ]);
  });

  it('collects issues from every invalid candidate, not just the first', () => {
    const badAdmit = { kind: 'AdmitPatient' };
    const badDischarge = { kind: 'DischargePatient' };

    const result = validateInstructions(patientInstructionValidators, [badAdmit, badDischarge]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.error).toHaveLength(2);
    expect(result.error[0]?.index).toBe(0);
    expect(result.error[1]?.index).toBe(1);
  });
});
