import { describe, expect, it } from 'vitest';
import { patientRiskTiers } from '../../../src/agentic/risk/patient.js';
import { effectiveTier } from '../../../src/agentic/risk/tiers.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';

const admit: PatientInstruction = {
  kind: 'AdmitPatient',
  patientId: patientId('patient-1'),
  encounterId: encounterId('encounter-1'),
  admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
};

const discharge: PatientInstruction = {
  kind: 'DischargePatient',
  encounterId: encounterId('encounter-1'),
  dischargedAt: isoTimestamp('2026-07-18T01:00:00.000Z'),
};

describe('effectiveTier', () => {
  it('is auto for an empty sequence', () => {
    expect(effectiveTier(patientRiskTiers, [])).toBe('auto');
  });

  it('is the tier of a single instruction', () => {
    expect(effectiveTier(patientRiskTiers, [admit])).toBe('review-required');
  });

  it('is the highest tier in the sequence, regardless of order', () => {
    expect(effectiveTier(patientRiskTiers, [admit, discharge])).toBe('approval-required');
    expect(effectiveTier(patientRiskTiers, [discharge, admit])).toBe('approval-required');
  });
});
