import { describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
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
import { credentialId, isoTimestamp, roleGrantId, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingContext, NursingEffect, NursingInstruction } from '../../../src/instructions/nursing/types.js';

const emptyNursingContext: NursingContext = { credentials: {}, roleGrants: {} };

const issueCredential: NursingInstruction = {
  kind: 'IssueCredential',
  credentialId: credentialId('cred-1'),
  staffId: staffId('dr-lin'),
  credentialType: 'MD-License',
  issuedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
  expiresAt: isoTimestamp('2027-08-01T00:00:00.000Z'),
};

const contextWithActiveCredential: NursingContext = {
  credentials: {
    'cred-1': {
      credentialId: credentialId('cred-1'),
      staffId: staffId('dr-lin'),
      credentialType: 'MD-License',
      status: 'active',
      issuedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
      expiresAt: isoTimestamp('2027-08-01T00:00:00.000Z'),
    },
  },
  roleGrants: {},
};

const grantRole: NursingInstruction = {
  kind: 'GrantRole',
  grantId: roleGrantId('grant-1'),
  staffId: staffId('dr-lin'),
  role: 'physician',
  credentialId: credentialId('cred-1'),
  grantedAt: isoTimestamp('2026-08-01T00:10:00.000Z'),
};

const issueProposal: PlanProposal<NursingInstruction> = {
  instructions: [issueCredential],
  rationale: 'issued per credentialing office record',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-08-01T00:00:00.000Z',
};

const grantProposal: PlanProposal<NursingInstruction> = {
  instructions: [grantRole],
  rationale: 'physician role granted per medical staff privileging',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-08-01T00:10:00.000Z',
};

/**
 * The nursing-domain counterpart to every other domain's own
 * `<domain>ApprovalFlowEndToEnd.test.ts` — same wiring, hand-constructed
 * proposals, and (unlike `nursingAgenticPipelineEndToEnd.test.ts`'s own
 * `GrantRole` test) a plain `createInMemoryIdentityProvider` rather than
 * `createNursingIdentityProvider`, the same simple-identity style every
 * other domain's approval-flow test already uses. That pipeline test
 * already proved a credentialing officer's real, committed-state-backed
 * role still cannot clear `GrantRole`'s tier; this file adds the half no
 * prior nursing test showed on its own — a `chief-medical-officer`
 * actually *succeeding* at that same tier, plus the UI panel derivation
 * and telemetry recording every other domain's own approval-flow test
 * already exercises.
 */
describe('nursing domain approval flow, end to end', () => {
  it('a credentialing-officer may approve an IssueCredential (review-required), and it commits', () => {
    const doOutcome = nursingEngine.executeSequence(emptyNursingContext, issueProposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = nursingVerifier.verify(issueProposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'review-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const telemetryLog = createInMemoryUiProposalTelemetryLog();
    const approvalPanel = deriveApprovalConfirmationPanel(issueProposal, decision);
    telemetryLog.record({ component: approvalPanel.component, outcome: 'rendered', reasons: decision.reasons, recordedAt: '2026-08-01T00:04:59.000Z' });
    expect(approvalPanel.props.credentialIds).toEqual(['cred-1']);

    const identityProvider = createInMemoryIdentityProvider([{ id: 'officer-tsai', displayName: 'Tsai (credentialing office)', roles: ['credentialing-officer'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, nursingRiskTiers, EXAMPLE_nursingApprovalPolicy, issueProposal, {
      approverId: 'officer-tsai',
      approved: true,
      decidedAt: '2026-08-01T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<NursingContext, NursingInstruction, NursingEffect>();
    const outcome = act(shell, {
      proposal: issueProposal,
      doOutcome,
      decision,
      baselineContext: emptyNursingContext,
      reexecute: (ctx) => nursingEngine.executeSequence(ctx, issueProposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({ commitOutcome: 'committed', approval: { approverId: 'officer-tsai', approverRole: 'credentialing-officer' } });
  });

  it('the same credentialing-officer may NOT approve a GrantRole (approval-required) — chief-medical-officer-only, and nothing commits', () => {
    const doOutcome = nursingEngine.executeSequence(contextWithActiveCredential, grantProposal.instructions);
    expect(doOutcome.ok).toBe(true);

    const decision = nursingVerifier.verify(grantProposal);
    expect(decision).toEqual({
      kind: 'needs-human-approval',
      reasons: ["sequence contains an instruction at risk tier 'approval-required'"],
    });
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([{ id: 'officer-tsai', displayName: 'Tsai (credentialing office)', roles: ['credentialing-officer'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, nursingRiskTiers, EXAMPLE_nursingApprovalPolicy, grantProposal, {
      approverId: 'officer-tsai',
      approved: true,
      decidedAt: '2026-08-01T00:15:00.000Z',
    });
    // Not impersonation this time -- a real, resolvable identity, just
    // one that doesn't hold a sufficient role for *this* tier.
    expect(resolution.kind).toBe('unresolved');

    const shell = createInMemoryShell<NursingContext, NursingInstruction, NursingEffect>();
    const outcome = act(shell, {
      proposal: grantProposal,
      doOutcome,
      decision,
      baselineContext: contextWithActiveCredential,
      reexecute: (ctx) => nursingEngine.executeSequence(ctx, grantProposal.instructions),
      recordedAt: '2026-08-01T00:15:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });

  it('a chief-medical-officer may approve the same GrantRole a credentialing-officer could not, and it commits', () => {
    const doOutcome = nursingEngine.executeSequence(contextWithActiveCredential, grantProposal.instructions);
    const decision = nursingVerifier.verify(grantProposal);
    if (decision.kind !== 'needs-human-approval') throw new Error('expected needs-human-approval');

    const identityProvider = createInMemoryIdentityProvider([{ id: 'officer-lin', displayName: 'Lin (CMO)', roles: ['chief-medical-officer'] }]);
    const resolution = resolveApprovalForProposal(identityProvider, nursingRiskTiers, EXAMPLE_nursingApprovalPolicy, grantProposal, {
      approverId: 'officer-lin',
      approved: true,
      decidedAt: '2026-08-01T00:15:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const shell = createInMemoryShell<NursingContext, NursingInstruction, NursingEffect>();
    const outcome = act(shell, {
      proposal: grantProposal,
      doOutcome,
      decision,
      baselineContext: contextWithActiveCredential,
      reexecute: (ctx) => nursingEngine.executeSequence(ctx, grantProposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-08-01T00:15:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
  });
});
