import { describe, expect, it } from 'vitest';
import { createNursingIdentityProvider } from '../../../src/agentic/identity/nursingIdentityProvider.js';
import { EXAMPLE_patientApprovalPolicy } from '../../../src/agentic/identity/patient.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { patientRiskTiers } from '../../../src/agentic/risk/patient.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { credentialId, isoTimestamp as nursingIsoTimestamp, roleGrantId, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingContext } from '../../../src/instructions/nursing/types.js';
import { encounterId, isoTimestamp } from '../../../src/instructions/patient/ids.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';

/**
 * Proves the actual connection docs/DETERMINISTIC_CORE_PATTERN.md's
 * nursing section flagged as a "first, not-yet-taken step": running a
 * real approval decision through `resolveApprovalForProposal` backed by
 * `createNursingIdentityProvider` instead of a fixed
 * `createInMemoryIdentityProvider` list — with zero changes to
 * `resolveApproval.ts`, `resolveApprovalForProposal.ts`, or `act()`,
 * the same "swap the provider, not the pipeline" property CDSS already
 * proved for planners.
 */
describe('nursing-backed identity provider, wired into a real approval decision', () => {
  const discharge: PatientInstruction = {
    kind: 'DischargePatient',
    encounterId: encounterId('encounter-1'),
    dischargedAt: isoTimestamp('2026-07-18T01:00:00.000Z'),
  };

  const proposal: PlanProposal<PatientInstruction> = {
    instructions: [discharge],
    rationale: 'discharge per attending note',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-19T00:00:00.000Z',
  };

  const nursingContext: NursingContext = {
    credentials: {
      'cred-1': {
        credentialId: credentialId('cred-1'),
        staffId: staffId('dr-lin'),
        credentialType: 'MD-License',
        status: 'active',
        issuedAt: nursingIsoTimestamp('2026-01-01T00:00:00.000Z'),
        expiresAt: nursingIsoTimestamp('2026-08-01T00:00:00.000Z'),
      },
    },
    roleGrants: {
      'grant-1': {
        grantId: roleGrantId('grant-1'),
        staffId: staffId('dr-lin'),
        role: 'physician', // DischargePatient's approval-required tier requires this, per EXAMPLE_patientApprovalPolicy
        credentialId: credentialId('cred-1'),
        grantedAt: nursingIsoTimestamp('2026-02-01T00:00:00.000Z'),
      },
    },
  };

  it('resolves and honors an approval while the approver\'s credential is still valid', () => {
    const identityProvider = createNursingIdentityProvider(nursingContext);

    const resolution = resolveApprovalForProposal(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, proposal, {
      approverId: 'dr-lin',
      approved: true,
      decidedAt: '2026-07-19T00:05:00.000Z', // before cred-1's 2026-08-01 expiry
    });

    expect(resolution).toEqual({
      kind: 'resolved',
      approval: { approverId: 'dr-lin', approverRole: 'physician', approved: true, decidedAt: '2026-07-19T00:05:00.000Z' },
    });
  });

  it('refuses to resolve the same approver once their backing credential has expired — the identity check is genuinely time-varying', () => {
    const identityProvider = createNursingIdentityProvider(nursingContext);

    const resolution = resolveApprovalForProposal(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, proposal, {
      approverId: 'dr-lin',
      approved: true,
      decidedAt: '2026-09-01T00:00:00.000Z', // after cred-1's 2026-08-01 expiry
    });

    expect(resolution).toEqual({
      kind: 'unresolved',
      reason: "identity 'dr-lin' holds none of the required roles [physician]",
    });
  });

  it('reports no identity found for a staff member who never appears in nursing state at all — distinct from holding no valid role', () => {
    const identityProvider = createNursingIdentityProvider(nursingContext);

    const resolution = resolveApprovalForProposal(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, proposal, {
      approverId: 'someone-never-credentialed',
      approved: true,
      decidedAt: '2026-07-19T00:05:00.000Z',
    });

    expect(resolution).toEqual({
      kind: 'unresolved',
      reason: "no identity found for approver 'someone-never-credentialed'",
    });
  });
});
