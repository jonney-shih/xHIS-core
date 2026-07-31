import { describe, expect, it } from 'vitest';
import { toUiRenderProposal } from '../../../src/agentic/ui/toUiRenderProposal.js';
import type { RawUiRenderOutput } from '../../../src/agentic/ui/toUiRenderProposal.js';
import { exampleComponentPropsValidators } from './fixtures/exampleComponents.js';

function rawOutput(component: unknown): RawUiRenderOutput {
  return {
    component,
    rationale: 'patient reports feeling feverish',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
  };
}

describe('toUiRenderProposal', () => {
  it('wraps a validated component into a full proposal, carrying rationale/provenance through untouched', () => {
    const result = toUiRenderProposal(
      exampleComponentPropsValidators,
      rawOutput({ component: 'VitalsEntryPanel', props: { encounterId: 'encounter-1' } }),
      '2026-07-30T00:00:00.000Z',
    );

    expect(result).toEqual({
      ok: true,
      value: {
        component: { component: 'VitalsEntryPanel', props: { encounterId: 'encounter-1', prefilledTemperatureCelsius: undefined, prefilledHeartRateBpm: undefined } },
        rationale: 'patient reports feeling feverish',
        modelVersion: 'stub-v0',
        promptVersion: 'stub-v0',
        proposedAt: '2026-07-30T00:00:00.000Z',
      },
    });
  });

  it('rejects the whole proposal when the component candidate fails validation — no partially-trusted proposal', () => {
    const result = toUiRenderProposal(
      exampleComponentPropsValidators,
      rawOutput({ component: 'VitalsEntryPanel', props: {} }),
      '2026-07-30T00:00:00.000Z',
    );

    expect(result).toEqual({ ok: false, error: ["'props.encounterId' must be a non-empty string"] });
  });
});
