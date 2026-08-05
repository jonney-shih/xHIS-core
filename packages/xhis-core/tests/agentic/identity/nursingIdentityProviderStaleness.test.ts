import { describe, expect, it } from 'vitest';
import { createNursingIdentityProvider } from '../../../src/agentic/identity/nursingIdentityProvider.js';
import { EXAMPLE_patientApprovalPolicy } from '../../../src/agentic/identity/patient.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { patientRiskTiers } from '../../../src/agentic/risk/patient.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { revokeCredentialHandler } from '../../../src/instructions/nursing/handlers/revokeCredential.js';
import { credentialId, isoTimestamp as nursingIsoTimestamp, roleGrantId, staffId } from '../../../src/instructions/nursing/ids.js';
import type { NursingContext } from '../../../src/instructions/nursing/types.js';
import { encounterId, isoTimestamp } from '../../../src/instructions/patient/ids.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';

/**
 * Originally documented a real, then-unguarded gap raised directly by a
 * human reviewer: `createNursingIdentityProvider` used to take a frozen
 * `NursingContext` snapshot, so nothing stopped a caller from resolving
 * an approval against one that had gone stale relative to nursing's
 * real, current state. Now that it takes a `readNursingContext`
 * callback, invoked fresh inside `resolve()` every time (see
 * `nursingIdentityProvider.ts`), this file proves the fix closes the
 * gap rather than merely describing it — the *same* provider instance,
 * never reconstructed, correctly reflects a revocation that happens
 * after it was created.
 */
describe('createNursingIdentityProvider reads nursing state fresh, not from a frozen snapshot', () => {
  const drLinCredentialId = credentialId('cred-dr-lin');

  const nursingContextBeforeRevocation: NursingContext = {
    credentials: {
      'cred-dr-lin': {
        credentialId: drLinCredentialId,
        staffId: staffId('dr-lin'),
        credentialType: 'MD-License',
        status: 'active',
        issuedAt: nursingIsoTimestamp('2026-01-01T00:00:00.000Z'),
        expiresAt: nursingIsoTimestamp('2027-01-01T00:00:00.000Z'),
      },
    },
    roleGrants: {
      'grant-dr-lin': {
        grantId: roleGrantId('grant-dr-lin'),
        staffId: staffId('dr-lin'),
        role: 'physician',
        credentialId: drLinCredentialId,
        grantedAt: nursingIsoTimestamp('2026-01-02T00:00:00.000Z'),
      },
    },
  };

  const dischargeProposal: PlanProposal<PatientInstruction> = {
    instructions: [{ kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-22T00:00:00.000Z') }],
    rationale: 'discharge per attending note',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-22T00:00:00.000Z',
  };

  it('the same provider instance stops honoring a physician the moment their credential is revoked in the real nursing state it reads from', () => {
    // A mutable binding standing in for "wherever nursing's real,
    // current state actually lives" (e.g. a file `readLatestContext`
    // would read from) — the provider is handed a callback that reads
    // *this*, not a value frozen at construction time.
    let currentNursingContext = nursingContextBeforeRevocation;
    const identityProvider = createNursingIdentityProvider(() => currentNursingContext);

    const beforeRevocation = resolveApprovalForProposal(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, dischargeProposal, {
      approverId: 'dr-lin',
      approved: true,
      decidedAt: '2026-07-22T00:00:00.000Z',
    });
    expect(beforeRevocation.kind).toBe('resolved');
    if (beforeRevocation.kind !== 'resolved') throw new Error('expected resolved');
    expect(beforeRevocation.approval.approverRole).toBe('physician');

    // Real world: dr-lin's credential gets revoked — for cause, say —
    // and nursing's real, current state moves on. Nothing re-creates
    // `identityProvider`; the same instance is consulted again below.
    const revocationResult = revokeCredentialHandler(currentNursingContext, {
      kind: 'RevokeCredential',
      credentialId: drLinCredentialId,
      revokedAt: nursingIsoTimestamp('2026-07-21T00:00:00.000Z'),
    });
    expect(revocationResult.ok).toBe(true);
    if (!revocationResult.ok) throw new Error('expected ok');
    currentNursingContext = revocationResult.value.context;

    // The fix: consulting the *same* provider instance again now
    // correctly refuses dr-lin, because `resolve()` re-read
    // `currentNursingContext` fresh rather than relying on whatever it
    // saw the first time.
    const afterRevocation = resolveApprovalForProposal(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, dischargeProposal, {
      approverId: 'dr-lin',
      approved: true,
      decidedAt: '2026-07-22T00:00:01.000Z',
    });
    expect(afterRevocation).toEqual({
      kind: 'unresolved',
      reason: "identity 'dr-lin' holds none of the required roles [physician]",
    });
  });
});
