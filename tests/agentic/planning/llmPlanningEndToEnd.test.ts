import { describe, expect, it } from 'vitest';
import { createLlmPlanner } from '../../../src/agentic/planning/llmPlanner.js';
import { patientPromptBuilder } from '../../../src/agentic/planning/patientPromptBuilder.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { patientInstructionValidators } from '../../../src/agentic/validation/patient.js';
import type { PatientContext } from '../../../src/instructions/patient/types.js';

const emptyContext: PatientContext = { encounters: {} };

/**
 * Exercises the whole untrusted-planner path end to end: a fake "model"
 * that hallucinates a nonexistent instruction kind on its first attempt,
 * gets told exactly why in its second prompt (via patientPromptBuilder's
 * feedback section), and produces a valid AdmitPatient on the second try.
 */
describe('LLM planner path, end to end', () => {
  it('recovers from a hallucinated instruction kind on retry', async () => {
    let call = 0;
    const seenPrompts: string[] = [];

    const planner = createLlmPlanner<PatientContext>(
      async (prompt) => {
        seenPrompts.push(prompt);
        call += 1;
        if (call === 1) {
          return '{"instructions":[{"kind":"PrescribeMedication","drug":"amoxicillin"}],"rationale":"per order"}';
        }
        return '{"instructions":[{"kind":"AdmitPatient","patientId":"p1","encounterId":"e1","admittedAt":"2026-07-18T00:00:00.000Z"}],"rationale":"admit per triage note"}';
      },
      patientPromptBuilder,
      'test-model-v1',
      'test-prompt-v1',
    );

    const result = await planWithRetries(
      planner,
      patientInstructionValidators,
      { description: 'admit the waiting patient' },
      emptyContext,
      '2026-07-19T00:00:00.000Z',
      3,
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

    expect(seenPrompts).toHaveLength(2);
    expect(seenPrompts[0]).not.toContain('previous attempt');
    expect(seenPrompts[1]).toContain('previous attempt');
    expect(seenPrompts[1]).toContain("unknown instruction kind 'PrescribeMedication'");
  });

  it('never produces a proposal at all when the model keeps hallucinating', async () => {
    const planner = createLlmPlanner<PatientContext>(
      async () => '{"instructions":[{"kind":"PrescribeMedication"}],"rationale":"still wrong"}',
      patientPromptBuilder,
      'test-model-v1',
      'test-prompt-v1',
    );

    const result = await planWithRetries(
      planner,
      patientInstructionValidators,
      { description: 'anything' },
      emptyContext,
      '2026-07-19T00:00:00.000Z',
      2,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.attempts).toBe(2);
  });
});
