import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCdssNursingPlanner } from '../../../src/agentic/planning/cdssNursingPlanner.js';
import type { CdssNursingContext, CredentialRevocationReadySignal } from '../../../src/agentic/planning/cdssNursingPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { nursingInstructionValidators } from '../../../src/agentic/validation/nursing.js';
import { nursingVerificationWorkers, nursingVerifier } from '../../../src/agentic/verification/nursing.js';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { createFileVerificationRecordStore, runVerificationWorker } from '../../../src/agentic/verification/verificationWorker.js';
import { resolveVerificationState } from '../../../src/agentic/verification/verificationState.js';
import { nursingRiskTiers } from '../../../src/agentic/risk/nursing.js';
import { EXAMPLE_nursingApprovalPolicy } from '../../../src/agentic/identity/nursing.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { createFileSchedulerActedStore, runScheduler } from '../../../src/agentic/shell/scheduler.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import { isoTimestamp } from '../../../src/core/temporal.js';
import { nursingEngine } from '../../../src/instructions/nursing/engine.js';
import { credentialId, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingContext, NursingEffect, NursingInstruction } from '../../../src/instructions/nursing/types.js';

const contextWithActiveCredential: NursingContext = {
  credentials: {
    'cred-1': { credentialId: credentialId('cred-1'), staffId: staffId('dr-lin'), credentialType: 'MD-License', status: 'active', issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'), expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z') },
  },
  roleGrants: {},
};
const requiredWorkers = nursingVerificationWorkers.map((worker) => worker.workerId);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-cdss-nursing-through-spine-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function newSpineFixtures() {
  return {
    proposalLog: createFileProposalLog<NursingInstruction>(join(dir, 'proposals.jsonl')),
    recordStore: createFileVerificationRecordStore(join(dir, 'records.jsonl')),
    actedStore: createFileSchedulerActedStore(join(dir, 'acted.jsonl')),
    shell: createInMemoryShell<NursingContext, NursingInstruction, NursingEffect>(),
  };
}

/** Mirrors `verifyWithAllImagingWorkers` in the imaging-domain CDSS
 * spine test — one independent, durably-cursored worker at a time, not
 * a single combined call. */
async function verifyWithAllNursingWorkers(
  proposalLog: ReturnType<typeof createFileProposalLog<NursingInstruction>>,
  recordStore: ReturnType<typeof createFileVerificationRecordStore>,
) {
  for (const worker of nursingVerificationWorkers) {
    await runVerificationWorker(
      worker,
      proposalLog,
      createFileOutboxCursor(join(dir, `cursor-${worker.workerId}.jsonl`)),
      recordStore,
      isoTimestamp('2026-08-01T01:01:00.000Z'),
    );
  }
}

/**
 * The nursing-domain counterpart to
 * `cdssImagingPlanningThroughVerificationSpineEndToEnd.test.ts` — the
 * last domain to get this proof: folding `nursingVerificationWorkers`'
 * independently recorded verdicts via `resolveVerificationState` must
 * reach the identical decision `nursingVerifier.verify` reaches inline
 * for a CDSS-sourced `RevokeCredential` proposal, and `runScheduler`
 * must correctly leave an unapproved proposal awaiting-approval rather
 * than acting on it.
 */
describe('a CDSS-sourced nursing proposal, Checked through the verification spine, reaches the same decision nursingVerifier already reaches inline', () => {
  it('needs human approval for a CDSS-recommended RevokeCredential exactly like nursingVerifier does, and the scheduler correctly leaves it awaiting-approval', async () => {
    const signal: CredentialRevocationReadySignal = { credentialId: credentialId('cred-1') };
    // Explicit type arguments: same mapped-type inference limitation
    // `createEngine` call sites already document (see
    // `nursing/engine.ts`).
    const planResult = await planWithRetries<CdssNursingContext, NursingInstruction>(
      createCdssNursingPlanner(),
      nursingInstructionValidators,
      { description: 'credentialing office sweep' },
      { nursingContext: contextWithActiveCredential, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const inlineDecision = nursingVerifier.verify(proposal);
    expect(inlineDecision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllNursingWorkers(proposalLog, recordStore);

    expect(resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers)).toEqual({
      kind: 'resolved',
      decision: inlineDecision,
    });

    const results = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers,
      actedStore,
      shell,
      engine: nursingEngine,
      initialContext: contextWithActiveCredential,
      recordedAt: '2026-08-01T01:02:00.000Z',
    });

    // No approval was ever supplied to the scheduler — same as calling
    // act() directly with no `approval`, which is exactly what
    // cdssNursingPlanningEndToEnd.test.ts's own unresolved-approval
    // test does.
    expect(results).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(shell.commits).toHaveLength(0);
  });

  it('a human approving afterward still commits, via the exact same mechanism the direct pipeline already uses', async () => {
    const signal: CredentialRevocationReadySignal = { credentialId: credentialId('cred-1') };
    const planResult = await planWithRetries<CdssNursingContext, NursingInstruction>(
      createCdssNursingPlanner(),
      nursingInstructionValidators,
      { description: 'credentialing office sweep' },
      { nursingContext: contextWithActiveCredential, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const { proposalLog, recordStore, actedStore, shell } = newSpineFixtures();
    const proposalId = proposalLog.append(proposal);
    await verifyWithAllNursingWorkers(proposalLog, recordStore);

    const schedulerResults = runScheduler({
      proposalLog,
      recordStore,
      requiredWorkers,
      actedStore,
      shell,
      engine: nursingEngine,
      initialContext: contextWithActiveCredential,
      recordedAt: '2026-08-01T01:02:00.000Z',
    });
    expect(schedulerResults).toEqual([{ proposalId, outcome: 'awaiting-approval' }]);
    expect(actedStore.hasActed(proposalId)).toBe(true);

    const decision = resolveVerificationState(recordStore.readAllFor(proposalId), requiredWorkers);
    if (decision.kind !== 'resolved') throw new Error('expected resolved');

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'officer-tsai', displayName: 'Tsai (credentialing office)', roles: ['credentialing-officer'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, nursingRiskTiers, EXAMPLE_nursingApprovalPolicy, proposal, {
      approverId: 'officer-tsai',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const latest = shell.readLatest() ?? contextWithActiveCredential;
    const finalOutcome = act(shell, {
      proposal,
      doOutcome: nursingEngine.executeSequence(latest, proposal.instructions),
      decision: decision.decision,
      baselineContext: latest,
      reexecute: (ctx) => nursingEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(finalOutcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.credentials['cred-1']).toMatchObject({ status: 'revoked' });
  });
});
