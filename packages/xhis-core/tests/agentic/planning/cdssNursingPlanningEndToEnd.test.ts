import { describe, expect, it } from 'vitest';
import { createCdssNursingPlanner } from '../../../src/agentic/planning/cdssNursingPlanner.js';
import type { CdssNursingContext, CredentialRevocationReadySignal } from '../../../src/agentic/planning/cdssNursingPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { nursingInstructionValidators } from '../../../src/agentic/validation/nursing.js';
import { nursingVerifier } from '../../../src/agentic/verification/nursing.js';
import { nursingRiskTiers } from '../../../src/agentic/risk/nursing.js';
import { EXAMPLE_nursingApprovalPolicy } from '../../../src/agentic/identity/nursing.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { deriveApprovalConfirmationPanel } from '../../../src/agentic/ui/nursing.js';
import { createInMemoryUiProposalTelemetryLog } from '../../../src/agentic/ui/telemetry.js';
import { nursingEngine } from '../../../src/instructions/nursing/engine.js';
import { credentialId, isoTimestamp, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingContext, NursingEffect, NursingInstruction } from '../../../src/instructions/nursing/types.js';

const contextWithActiveCredential: NursingContext = {
  credentials: {
    'cred-1': { credentialId: credentialId('cred-1'), staffId: staffId('dr-lin'), credentialType: 'MD-License', status: 'active', issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'), expiresAt: isoTimestamp('2027-01-01T00:00:00.000Z') },
  },
  roleGrants: {},
};

/**
 * The nursing-domain counterpart to `cdssImagingPlanningEndToEnd.test.ts`
 * — same `planWithRetries` -> `toPlanProposal` -> Do -> Check -> approval
 * -> Act pipeline, now driven by `createCdssNursingPlanner`. Like
 * imaging's own end-to-end file, there is no "role X fails, role Y
 * succeeds" contrast to draw here: `RevokeCredential` sits at
 * `review-required`, where either `credentialing-officer` or
 * `chief-medical-officer` already suffices (see `risk/nursing.ts`), so
 * the interesting proof is only that a CDSS recommendation still needs
 * *some* permitted approval, never an outright `accept`. Does not
 * repeat the `suggestVitalsEntryPanel`/`resolveUiRenderOutcome` tests
 * for the same reason every prior non-patient CDSS end-to-end file
 * doesn't: no Agent-selected UI component exists for nursing.
 */
describe('CDSS nursing-revocation planning path, end to end', () => {
  it('retrying a deterministic rule against an unchanging bad timestamp produces the identical failure every attempt, unlike an LLM recovering from feedback', async () => {
    // Same reasoning `cdssPharmacyPlanningEndToEnd.test.ts`'s own retry
    // test gives: `signal.credentialId` only ever reaches the output
    // after being matched against a real, already-valid `credentialId`
    // key in `context.nursingContext.credentials` (see
    // `cdssNursingPlanner.ts`'s own filter), so an unknown or malformed
    // one is filtered out, not propagated. `proposedAt` is the one input
    // that flows straight into `revokedAt` unvalidated, and
    // `planWithRetries` passes the same one to every attempt.
    const signal: CredentialRevocationReadySignal = { credentialId: credentialId('cred-1') };
    const planner = createCdssNursingPlanner();

    // Explicit type arguments: same mapped-type inference limitation
    // `createEngine` call sites already document (see
    // `nursing/engine.ts`).
    const result = await planWithRetries<CdssNursingContext, NursingInstruction>(
      planner,
      nursingInstructionValidators,
      { description: 'credentialing office sweep' },
      { nursingContext: contextWithActiveCredential, signals: [signal] },
      'not-a-timestamp',
      3,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.attempts).toBe(3);
    expect(result.error.issues).toEqual(["instruction 0: 'revokedAt' must be an ISO-8601 timestamp string"]);
  });

  it('a CDSS-recommended revocation is not exempt from risk-tiered human approval, and commits once a permitted identity approves', async () => {
    const signal: CredentialRevocationReadySignal = { credentialId: credentialId('cred-1') };
    const planner = createCdssNursingPlanner();

    const planResult = await planWithRetries<CdssNursingContext, NursingInstruction>(
      planner,
      nursingInstructionValidators,
      { description: 'credentialing office sweep' },
      { nursingContext: contextWithActiveCredential, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    // Do — against the real, plain `NursingContext`, entirely decoupled
    // from `CdssNursingContext`: Do/Check/Act never know or care that
    // this proposal came from a rule engine rather than a model.
    const doOutcome = nursingEngine.executeSequence(contextWithActiveCredential, proposal.instructions);
    expect(doOutcome.ok).toBe(true);

    // Check — the same `nursingVerifier` an LLM-sourced proposal would
    // go through. `RevokeCredential` is `review-required` (see
    // `risk/nursing.ts`), so this must be `needs-human-approval`, never
    // `accept` outright, regardless of how deterministic the source
    // rule was.
    const decision = nursingVerifier.verify(proposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const telemetryLog = createInMemoryUiProposalTelemetryLog();
    const approvalPanel = deriveApprovalConfirmationPanel(proposal, decision);
    telemetryLog.record({
      component: approvalPanel.component,
      outcome: 'rendered',
      reasons: decision.reasons,
      recordedAt: '2026-08-01T01:04:59.000Z',
    });

    expect(approvalPanel).toEqual({
      component: 'ApprovalConfirmationPanel',
      props: {
        credentialIds: ['cred-1'],
        instructionSummary: ['RevokeCredential — cred-1'],
        riskReasons: ["sequence contains an instruction at risk tier 'review-required'"],
        modelVersion: 'cdss-nursing-revocation-rule-engine-v1',
        promptVersion: 'nursing-revocation-ruleset-v1',
      },
    });
    expect(telemetryLog.entries).toHaveLength(1);

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

    const shell = createInMemoryShell<NursingContext, NursingInstruction, NursingEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithActiveCredential,
      reexecute: (ctx) => nursingEngine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.credentials['cred-1']).toMatchObject({ credentialId: 'cred-1', status: 'revoked' });
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      proposal: { modelVersion: 'cdss-nursing-revocation-rule-engine-v1', promptVersion: 'nursing-revocation-ruleset-v1' },
      approval: { approverId: 'officer-tsai', approverRole: 'credentialing-officer' },
    });
  });

  it('an unresolved (impersonated) approval leaves a CDSS-recommended revocation awaiting approval, never committed', async () => {
    const signal: CredentialRevocationReadySignal = { credentialId: credentialId('cred-1') };
    const planner = createCdssNursingPlanner();

    const planResult = await planWithRetries<CdssNursingContext, NursingInstruction>(
      planner,
      nursingInstructionValidators,
      { description: 'credentialing office sweep' },
      { nursingContext: contextWithActiveCredential, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      1,
    );
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) throw new Error('expected ok');
    const proposal = planResult.value;

    const doOutcome = nursingEngine.executeSequence(contextWithActiveCredential, proposal.instructions);
    const decision = nursingVerifier.verify(proposal);

    const identityProvider = createInMemoryIdentityProvider([
      { id: 'officer-tsai', displayName: 'Tsai (credentialing office)', roles: ['credentialing-officer'] },
    ]);
    const resolution = resolveApprovalForProposal(identityProvider, nursingRiskTiers, EXAMPLE_nursingApprovalPolicy, proposal, {
      approverId: 'someone-pretending-to-be-officer-tsai',
      approved: true,
      decidedAt: '2026-08-01T01:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<NursingContext, NursingInstruction, NursingEffect>();
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: contextWithActiveCredential,
      reexecute: (ctx) => nursingEngine.executeSequence(ctx, proposal.instructions),
      recordedAt: '2026-08-01T01:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
