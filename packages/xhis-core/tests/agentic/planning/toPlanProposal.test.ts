import { describe, expect, it } from 'vitest';
import { toPlanProposal } from '../../../src/agentic/planning/toPlanProposal.js';
import { patientInstructionValidators } from '../../../src/agentic/validation/patient.js';

describe('toPlanProposal', () => {
  it('constructs a PlanProposal when every candidate instruction validates', () => {
    const result = toPlanProposal(
      patientInstructionValidators,
      {
        instructions: [
          { kind: 'AdmitPatient', patientId: 'p1', encounterId: 'e1', admittedAt: '2026-07-18T00:00:00.000Z' },
        ],
        rationale: 'admit per triage note',
        modelVersion: 'test-model-v1',
        promptVersion: 'test-prompt-v1',
      },
      '2026-07-19T00:00:00.000Z',
    );

    expect(result).toEqual({
      ok: true,
      value: {
        instructions: [
          { kind: 'AdmitPatient', patientId: 'p1', encounterId: 'e1', admittedAt: '2026-07-18T00:00:00.000Z' },
        ],
        rationale: 'admit per triage note',
        modelVersion: 'test-model-v1',
        promptVersion: 'test-prompt-v1',
        proposedAt: '2026-07-19T00:00:00.000Z',
      },
    });
  });

  it('never constructs a proposal when a candidate instruction is invalid, even if others are fine', () => {
    const result = toPlanProposal(
      patientInstructionValidators,
      {
        instructions: [
          { kind: 'AdmitPatient', patientId: 'p1', encounterId: 'e1', admittedAt: '2026-07-18T00:00:00.000Z' },
          { kind: 'DischargePatient', encounterId: 'e1' },
        ],
        rationale: 'hallucinated discharge',
        modelVersion: 'test-model-v1',
        promptVersion: 'test-prompt-v1',
      },
      '2026-07-19T00:00:00.000Z',
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.error).toEqual([
      { index: 1, issues: ["'dischargedAt' must be an ISO-8601 timestamp string"] },
    ]);
  });

  it('rejects an instruction kind that does not exist at all, as an LLM hallucination would produce', () => {
    const result = toPlanProposal(
      patientInstructionValidators,
      {
        instructions: [{ kind: 'PrescribeMedication', drug: 'amoxicillin' }],
        rationale: 'hallucinated instruction kind',
        modelVersion: 'test-model-v1',
        promptVersion: 'test-prompt-v1',
      },
      '2026-07-19T00:00:00.000Z',
    );

    expect(result).toEqual({
      ok: false,
      error: [{ index: 0, issues: ["unknown instruction kind 'PrescribeMedication'"] }],
    });
  });
});
