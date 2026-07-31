import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { bedVerificationWorkers, bedVerifier } from '../../../src/agentic/verification/bed.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp as verifiedAtTimestamp } from '../../../src/core/temporal.js';
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

/**
 * The same claim `cdssPlanningThroughVerificationSpineEndToEnd.test.ts`
 * proved for patient: folding `bedVerificationWorkers`' independently
 * recorded verdicts via `resolveVerificationState` must reach the
 * identical decision `bedVerifier.verify` reaches inline. Built with
 * hand-constructed proposals, not a planner's output — bed has no
 * CDSS/LLM planner today (see `ui/bed.ts`'s own doc comment), so this
 * uses the same fixture style `bedVerifier`'s own tests above already
 * do, rather than inventing a planner this domain hasn't asked for.
 */
describe('the bed domain Checked through the verification spine reaches the same decisions bedVerifier already reaches inline', () => {
  const requiredWorkers = bedVerificationWorkers.map((worker) => worker.workerId);
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xhis-bed-verification-spine-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function verifyThroughSpine(bedProposal: PlanProposal<BedInstruction>) {
    const proposalLog = createFileProposalLog<BedInstruction>(join(dir, 'proposals.jsonl'));
    const recordStore = createFileVerificationRecordStore(join(dir, 'records.jsonl'));
    const proposalId = proposalLog.append(bedProposal);

    for (const worker of bedVerificationWorkers) {
      await runVerificationWorker(
        worker,
        proposalLog,
        createFileOutboxCursor(join(dir, `cursor-${worker.workerId}.jsonl`)),
        recordStore,
        verifiedAtTimestamp('2026-08-01T00:01:00.000Z'),
      );
    }

    return resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers);
  }

  it('needs human approval for AssignBed, exactly like bedVerifier does', async () => {
    const inlineDecision = bedVerifier.verify(proposal());
    expect(await verifyThroughSpine(proposal())).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('rejects a leaked-national-ID rationale exactly like bedVerifier does, without needing every worker to report', async () => {
    const leakyProposal = proposal({ rationale: 'national ID A123456789 confirms identity' });
    const inlineDecision = bedVerifier.verify(leakyProposal);
    expect(inlineDecision.kind).toBe('reject');

    expect(await verifyThroughSpine(leakyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('accepts a proposal with nothing to review, exactly like bedVerifier does', async () => {
    const emptyProposal = proposal({ instructions: [] });
    const inlineDecision = bedVerifier.verify(emptyProposal);
    expect(inlineDecision).toEqual({ kind: 'accept' });

    expect(await verifyThroughSpine(emptyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });
});
