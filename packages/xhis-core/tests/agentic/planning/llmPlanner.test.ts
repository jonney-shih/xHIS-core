import { describe, expect, it } from 'vitest';
import { createLlmPlanner } from '../../../src/agentic/planning/llmPlanner.js';
import type { PatientContext } from '../../../src/instructions/patient/types.js';

const emptyContext: PatientContext = { encounters: {} };

function plannerReturning(responseText: string) {
  return createLlmPlanner<PatientContext>(
    async () => responseText,
    { build: () => 'irrelevant prompt' },
    'test-model-v1',
    'test-prompt-v1',
  );
}

describe('createLlmPlanner', () => {
  it('parses a valid response into a RawPlanOutput', async () => {
    const planner = plannerReturning('{"instructions":[{"kind":"AdmitPatient"}],"rationale":"per triage note"}');

    const result = await planner.plan({ description: 'admit the waiting patient' }, emptyContext, '2026-07-19T00:00:00.000Z', []);

    expect(result).toEqual({
      ok: true,
      value: {
        instructions: [{ kind: 'AdmitPatient' }],
        rationale: 'per triage note',
        modelVersion: 'test-model-v1',
        promptVersion: 'test-prompt-v1',
      },
    });
  });

  it('parses a response wrapped in a markdown code fence', async () => {
    const planner = plannerReturning('```json\n{"instructions":[],"rationale":"nothing to do"}\n```');

    const result = await planner.plan({ description: 'anything' }, emptyContext, '2026-07-19T00:00:00.000Z', []);

    expect(result.ok).toBe(true);
  });

  it('fails when the response is not parseable as JSON at all', async () => {
    const planner = plannerReturning('I cannot help with that.');

    const result = await planner.plan({ description: 'anything' }, emptyContext, '2026-07-19T00:00:00.000Z', []);

    expect(result.ok).toBe(false);
  });

  it("fails when the parsed response is missing the 'instructions' array", async () => {
    const planner = plannerReturning('{"rationale":"forgot the instructions"}');

    const result = await planner.plan({ description: 'anything' }, emptyContext, '2026-07-19T00:00:00.000Z', []);

    expect(result).toEqual({ ok: false, error: "parsed response is missing an 'instructions' array" });
  });

  it("fails when the parsed response is missing the 'rationale' string", async () => {
    const planner = plannerReturning('{"instructions":[]}');

    const result = await planner.plan({ description: 'anything' }, emptyContext, '2026-07-19T00:00:00.000Z', []);

    expect(result).toEqual({ ok: false, error: "parsed response is missing a 'rationale' string" });
  });

  it('passes goal, context, and feedback through to the prompt builder', async () => {
    const seenPrompts: string[] = [];
    const planner = createLlmPlanner<PatientContext>(
      async (prompt) => {
        seenPrompts.push(prompt);
        return '{"instructions":[],"rationale":"ok"}';
      },
      { build: (goal, _context, feedback) => `GOAL:${goal.description} FEEDBACK:${feedback.join('|')}` },
      'test-model-v1',
      'test-prompt-v1',
    );

    await planner.plan({ description: 'discharge encounter-1' }, emptyContext, '2026-07-19T00:00:00.000Z', ['prior issue']);

    expect(seenPrompts).toEqual(['GOAL:discharge encounter-1 FEEDBACK:prior issue']);
  });
});
