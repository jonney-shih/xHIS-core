import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { combineVerifiers } from '../../../src/agentic/verification/combineVerifiers.js';
import type { Verifier, VerifyDecision } from '../../../src/agentic/verification/verifier.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';

const emptyProposal: PlanProposal<PatientInstruction> = {
  instructions: [],
  rationale: 'irrelevant to these fakes',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-07-19T00:00:00.000Z',
};

function fakeVerifier(decision: VerifyDecision): Verifier<PatientInstruction> {
  return { verify: () => decision };
}

describe('combineVerifiers', () => {
  it('accepts when every verifier accepts', () => {
    const verifier = combineVerifiers(fakeVerifier({ kind: 'accept' }), fakeVerifier({ kind: 'accept' }));
    expect(verifier.verify(emptyProposal)).toEqual({ kind: 'accept' });
  });

  it('accepts everything when given no verifiers at all', () => {
    expect(combineVerifiers<PatientInstruction>().verify(emptyProposal)).toEqual({ kind: 'accept' });
  });

  it('needs-human-approval beats accept', () => {
    const verifier = combineVerifiers(
      fakeVerifier({ kind: 'accept' }),
      fakeVerifier({ kind: 'needs-human-approval', reasons: ['big batch'] }),
    );
    expect(verifier.verify(emptyProposal)).toEqual({ kind: 'needs-human-approval', reasons: ['big batch'] });
  });

  it('reject beats needs-human-approval and accept', () => {
    const verifier = combineVerifiers(
      fakeVerifier({ kind: 'needs-human-approval', reasons: ['big batch'] }),
      fakeVerifier({ kind: 'reject', reasons: ['leaked id'] }),
      fakeVerifier({ kind: 'accept' }),
    );
    expect(verifier.verify(emptyProposal)).toEqual({ kind: 'reject', reasons: ['leaked id'] });
  });

  it('merges reasons when two verifiers agree on the same severity', () => {
    const verifier = combineVerifiers(
      fakeVerifier({ kind: 'reject', reasons: ['leaked id'] }),
      fakeVerifier({ kind: 'reject', reasons: ['leaked phone number'] }),
    );
    expect(verifier.verify(emptyProposal)).toEqual({ kind: 'reject', reasons: ['leaked id', 'leaked phone number'] });
  });
});
