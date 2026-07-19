import { describe, expect, it } from 'vitest';
import { patientPromptBuilder } from '../../../src/agentic/planning/patientPromptBuilder.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext } from '../../../src/instructions/patient/types.js';

describe('patientPromptBuilder', () => {
  const context: PatientContext = {
    encounters: {
      'encounter-1': {
        encounterId: encounterId('encounter-1'),
        patientId: patientId('patient-1'),
        status: 'admitted',
        admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
      },
    },
  };

  it('includes the goal, the instruction schema, and the current encounters', () => {
    const prompt = patientPromptBuilder.build({ description: 'discharge encounter-1' }, context, []);

    expect(prompt).toContain('discharge encounter-1');
    expect(prompt).toContain('AdmitPatient');
    expect(prompt).toContain('DischargePatient');
    expect(prompt).toContain('encounter-1');
  });

  it('instructs the model not to put identifiers in the rationale', () => {
    const prompt = patientPromptBuilder.build({ description: 'anything' }, context, []);

    expect(prompt).toContain('never include');
  });

  it('omits a feedback section when there is no prior feedback', () => {
    const prompt = patientPromptBuilder.build({ description: 'anything' }, context, []);

    expect(prompt).not.toContain('previous attempt');
  });

  it('includes a feedback section listing every prior issue when retrying', () => {
    const prompt = patientPromptBuilder.build({ description: 'anything' }, context, [
      "unknown instruction kind 'PrescribeMedication'",
      "'admittedAt' must be an ISO-8601 timestamp string",
    ]);

    expect(prompt).toContain('previous attempt');
    expect(prompt).toContain("unknown instruction kind 'PrescribeMedication'");
    expect(prompt).toContain("'admittedAt' must be an ISO-8601 timestamp string");
  });
});
