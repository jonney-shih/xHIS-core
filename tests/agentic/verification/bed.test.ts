import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { bedVerifier } from '../../../src/agentic/verification/bed.js';
import { bedId, isoTimestamp } from '../../../src/instructions/bed/ids.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { BedInstruction } from '../../../src/instructions/bed/types.js';

const assignBed: BedInstruction = {
  kind: 'AssignBed',
  bedId: bedId('bed-1'),
  encounterId: encounterId('encounter-1'),
  assignedAt: isoTimestamp('2026-07-22T00:00:00.000Z'),
};

const releaseBed: BedInstruction = {
  kind: 'ReleaseBed',
  bedId: bedId('bed-1'),
  releasedAt: isoTimestamp('2026-07-22T02:00:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<BedInstruction>> = {}): PlanProposal<BedInstruction> {
  return {
    instructions: [assignBed],
    rationale: 'assigned per bed board',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('bedVerifier', () => {
  it('needs human approval for AssignBed, via risk tier alone', () => {
    expect(bedVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it('needs human approval for ReleaseBed too, at the same tier', () => {
    expect(bedVerifier.verify(proposal({ instructions: [releaseBed] }))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = bedVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });

  it('flags a batch larger than BED_MAX_BATCH_SIZE for human approval', () => {
    const oversized = new Array(21).fill(assignBed);
    const result = bedVerifier.verify(proposal({ instructions: oversized }));

    expect(result.kind).toBe('needs-human-approval');
  });
});
