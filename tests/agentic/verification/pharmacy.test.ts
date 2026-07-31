import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { pharmacyVerificationWorkers, pharmacyVerifier } from '../../../src/agentic/verification/pharmacy.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp as verifiedAtTimestamp } from '../../../src/core/temporal.js';
import { encounterId, isoTimestamp, prescriptionId } from '../../../src/instructions/pharmacy/ids.js';
import type { PharmacyInstruction } from '../../../src/instructions/pharmacy/types.js';

const prescribe: PharmacyInstruction = {
  kind: 'PrescribeMedication',
  prescriptionId: prescriptionId('rx-1'),
  encounterId: encounterId('encounter-1'),
  medicationCode: 'AMOX-500',
  prescribedAt: isoTimestamp('2026-07-31T00:00:00.000Z'),
};

const dispense: PharmacyInstruction = {
  kind: 'DispenseMedication',
  prescriptionId: prescriptionId('rx-1'),
  dispensedAt: isoTimestamp('2026-07-31T01:00:00.000Z'),
};

function proposal(overrides: Partial<PlanProposal<PharmacyInstruction>> = {}): PlanProposal<PharmacyInstruction> {
  return {
    instructions: [prescribe],
    rationale: 'prescribed per attending order',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('pharmacyVerifier', () => {
  it('needs human approval for PrescribeMedication, via risk tier alone', () => {
    expect(pharmacyVerifier.verify(proposal())).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
  });

  it('needs human approval for DispenseMedication too, at its own (higher) tier', () => {
    expect(pharmacyVerifier.verify(proposal({ instructions: [dispense] }))).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
  });

  it('rejects outright when the rationale leaks a national ID, overriding what risk tier alone would allow', () => {
    const result = pharmacyVerifier.verify(proposal({ rationale: 'national ID A123456789 confirms identity' }));

    expect(result.kind).toBe('reject');
  });

  it('flags a batch larger than PHARMACY_MAX_BATCH_SIZE for human approval', () => {
    const oversized = new Array(21).fill(prescribe);
    const result = pharmacyVerifier.verify(proposal({ instructions: oversized }));

    expect(result.kind).toBe('needs-human-approval');
  });
});

/**
 * The same claim proven for patient, bed, and lab, now for the fourth
 * real domain: folding `pharmacyVerificationWorkers`' independently
 * recorded verdicts must reach the identical decision
 * `pharmacyVerifier.verify` reaches inline. Pharmacy shares lab's
 * genuinely-two-tier shape (`review-required` for `PrescribeMedication`,
 * `approval-required` for `DispenseMedication`), so this proves the
 * spine reaches the correct tier here too, not just *a* tier.
 */
describe('the pharmacy domain Checked through the verification spine reaches the same decisions pharmacyVerifier already reaches inline', () => {
  const requiredWorkers = pharmacyVerificationWorkers.map((worker) => worker.workerId);
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xhis-pharmacy-verification-spine-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function verifyThroughSpine(pharmacyProposal: PlanProposal<PharmacyInstruction>) {
    const proposalLog = createFileProposalLog<PharmacyInstruction>(join(dir, 'proposals.jsonl'));
    const recordStore = createFileVerificationRecordStore(join(dir, 'records.jsonl'));
    const proposalId = proposalLog.append(pharmacyProposal);

    for (const worker of pharmacyVerificationWorkers) {
      await runVerificationWorker(
        worker,
        proposalLog,
        createFileOutboxCursor(join(dir, `cursor-${worker.workerId}.jsonl`)),
        recordStore,
        verifiedAtTimestamp('2026-07-31T00:01:00.000Z'),
      );
    }

    return resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers);
  }

  it('needs human approval for PrescribeMedication at review-required, exactly like pharmacyVerifier does', async () => {
    const inlineDecision = pharmacyVerifier.verify(proposal());
    expect(await verifyThroughSpine(proposal())).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('needs human approval for DispenseMedication at its own, higher approval-required tier, exactly like pharmacyVerifier does', async () => {
    const dispenseProposal = proposal({ instructions: [dispense] });
    const inlineDecision = pharmacyVerifier.verify(dispenseProposal);
    expect(inlineDecision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });

    expect(await verifyThroughSpine(dispenseProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('rejects a leaked-national-ID rationale exactly like pharmacyVerifier does, without needing every worker to report', async () => {
    const leakyProposal = proposal({ rationale: 'national ID A123456789 confirms identity' });
    const inlineDecision = pharmacyVerifier.verify(leakyProposal);
    expect(inlineDecision.kind).toBe('reject');

    expect(await verifyThroughSpine(leakyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });

  it('accepts a proposal with nothing to review, exactly like pharmacyVerifier does', async () => {
    const emptyProposal = proposal({ instructions: [] });
    const inlineDecision = pharmacyVerifier.verify(emptyProposal);
    expect(inlineDecision).toEqual({ kind: 'accept' });

    expect(await verifyThroughSpine(emptyProposal)).toEqual({ kind: 'resolved', decision: inlineDecision });
  });
});
