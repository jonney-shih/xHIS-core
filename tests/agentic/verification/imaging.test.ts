import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { imagingVerifier } from '../../../src/agentic/verification/imaging.js';
import { isoTimestamp, studyId } from '../../../src/instructions/imaging/ids.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { ImagingInstruction } from '../../../src/instructions/imaging/types.js';

const orderStudy: ImagingInstruction = {
  kind: 'OrderStudy',
  studyId: studyId('study-1'),
  encounterId: encounterId('encounter-1'),
  modality: 'CT',
  orderedAt: isoTimestamp('2026-07-22T00:00:00.000Z'),
};

const reportStudy: ImagingInstruction = {
  kind: 'ReportStudy',
  studyId: studyId('study-1'),
  reportText: 'No acute findings.',
  reportedAt: isoTimestamp('2026-07-22T01:00:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<ImagingInstruction>> = {}): PlanProposal<ImagingInstruction> {
  return {
    instructions: [orderStudy],
    rationale: 'ordered per attending note',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('imagingVerifier', () => {
  it('needs human approval for OrderStudy, via risk tier alone', () => {
    expect(imagingVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it('needs human approval for ReportStudy too, at its own (higher) tier', () => {
    expect(imagingVerifier.verify(proposal({ instructions: [reportStudy] }))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = imagingVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });

  it('flags a batch larger than IMAGING_MAX_BATCH_SIZE for human approval', () => {
    const oversized = new Array(21).fill(orderStudy);
    const result = imagingVerifier.verify(proposal({ instructions: oversized }));

    expect(result.kind).toBe('needs-human-approval');
  });
});
