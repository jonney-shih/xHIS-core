import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '../../../src/core/execution/result.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import type { RawPlanner, RawPlanOutput } from '../../../src/agentic/planning/toPlanProposal.js';
import { patientInstructionValidators } from '../../../src/agentic/validation/patient.js';
import type { PatientContext } from '../../../src/instructions/patient/types.js';

const emptyContext: PatientContext = { encounters: {} };

function scriptedPlanner(
  responses: readonly Result<RawPlanOutput, string>[],
): { planner: RawPlanner<PatientContext>; feedbackSeen: (readonly string[])[] } {
  const feedbackSeen: (readonly string[])[] = [];
  let call = 0;

  return {
    feedbackSeen,
    planner: {
      async plan(_goal, _context, _proposedAt, feedback) {
        feedbackSeen.push(feedback);
        const response = responses[call]!;
        call += 1;
        return response;
      },
    },
  };
}

const validRawOutput: RawPlanOutput = {
  instructions: [{ kind: 'AdmitPatient', patientId: 'p1', encounterId: 'e1', admittedAt: '2026-07-18T00:00:00.000Z' }],
  rationale: 'admit per triage note',
  modelVersion: 'test-model-v1',
  promptVersion: 'test-prompt-v1',
};

describe('planWithRetries', () => {
  it('succeeds on the first attempt when the planner produces a valid proposal', async () => {
    const { planner } = scriptedPlanner([ok(validRawOutput)]);

    const result = await planWithRetries(
      planner,
      patientInstructionValidators,
      { description: 'admit the waiting patient' },
      emptyContext,
      '2026-07-19T00:00:00.000Z',
      3,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([
      { kind: 'AdmitPatient', patientId: 'p1', encounterId: 'e1', admittedAt: '2026-07-18T00:00:00.000Z' },
    ]);
  });

  it('retries with the parse error as feedback when the planner fails to produce parseable output', async () => {
    const { planner, feedbackSeen } = scriptedPlanner([err('no valid JSON object found in the response'), ok(validRawOutput)]);

    const result = await planWithRetries(planner, patientInstructionValidators, { description: 'anything' }, emptyContext, '2026-07-19T00:00:00.000Z', 3);

    expect(result.ok).toBe(true);
    expect(feedbackSeen).toEqual([[], ['no valid JSON object found in the response']]);
  });

  it('retries with per-instruction validation issues as feedback when a candidate fails validation', async () => {
    const invalidRawOutput: RawPlanOutput = {
      instructions: [{ kind: 'PrescribeMedication', drug: 'amoxicillin' }],
      rationale: 'hallucinated instruction',
      modelVersion: 'test-model-v1',
      promptVersion: 'test-prompt-v1',
    };
    const { planner, feedbackSeen } = scriptedPlanner([ok(invalidRawOutput), ok(validRawOutput)]);

    const result = await planWithRetries(planner, patientInstructionValidators, { description: 'anything' }, emptyContext, '2026-07-19T00:00:00.000Z', 3);

    expect(result.ok).toBe(true);
    expect(feedbackSeen[1]).toEqual(["instruction 0: unknown instruction kind 'PrescribeMedication'"]);
  });

  it('exhausts every attempt and reports the last feedback when the planner never succeeds', async () => {
    const badOutput: RawPlanOutput = {
      instructions: [{ kind: 'PrescribeMedication' }],
      rationale: 'still wrong',
      modelVersion: 'test-model-v1',
      promptVersion: 'test-prompt-v1',
    };
    const { planner } = scriptedPlanner([ok(badOutput), ok(badOutput), ok(badOutput)]);

    const result = await planWithRetries(planner, patientInstructionValidators, { description: 'anything' }, emptyContext, '2026-07-19T00:00:00.000Z', 3);

    expect(result).toEqual({
      ok: false,
      error: { attempts: 3, issues: ["instruction 0: unknown instruction kind 'PrescribeMedication'"] },
    });
  });
});
