import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { createRationalePiiScanVerifier } from '../../../src/agentic/verification/pdpaRules.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';

function proposalWithRationale(rationale: string): PlanProposal<PatientInstruction> {
  return {
    instructions: [],
    rationale,
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-19T00:00:00.000Z',
  };
}

describe('createRationalePiiScanVerifier', () => {
  const verifier = createRationalePiiScanVerifier<PatientInstruction>();

  it('accepts a rationale with no sensitive-looking text', () => {
    expect(verifier.verify(proposalWithRationale('admit per triage note, bed 4 available'))).toEqual({
      kind: 'accept',
    });
  });

  it('rejects a rationale containing a Taiwan National ID-shaped string', () => {
    const result = verifier.verify(proposalWithRationale('patient national ID is A123456789 per intake form'));

    expect(result).toEqual({
      kind: 'reject',
      reasons: [
        'rationale appears to contain a Taiwan National ID number — must be removed before this proposal can be re-planned',
      ],
    });
  });

  it('rejects a rationale containing a Taiwan mobile phone number', () => {
    const result = verifier.verify(proposalWithRationale('contact family at 0912-345-678 before discharge'));

    expect(result.kind).toBe('reject');
  });

  it('reports every distinct pattern that matched', () => {
    const result = verifier.verify(proposalWithRationale('ID A123456789, phone 0912345678'));

    expect(result.kind).toBe('reject');
    if (result.kind !== 'reject') throw new Error('expected reject');
    expect(result.reasons).toHaveLength(2);
  });
});
