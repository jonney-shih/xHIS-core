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
 * Documents a real, currently-unguarded gap raised directly by a human
 * reviewer, distinct from — and not fixed by — the optimistic-concurrency
 * check `act()`/`actHuman()` already do before committing.
 * `createNursingIdentityProvider` takes a frozen `NursingContext`
 * snapshot, not a live handle; its own doc comment recommends that a
 * caller "re-derives a fresh provider from whatever `NursingContext` is
 * current," but nothing enforces or verifies that. `isCredentialValidAsOf`
 * (`credentialValidity.ts`) can only check a credential record *within*
 * whatever snapshot it was given — it has no way to know the snapshot
 * itself has gone stale relative to the real world. `asOf` answers "was
 * this credential valid at this moment, according to what this snapshot
 * recorded," not "does this snapshot still reflect reality as of this
 * moment" — a materially different, and here unanswered, question.
 *
 * This test asserts the *current*, gapped behavior (it passes today,
 * without any fix) specifically to make the gap concrete before deciding
 * how to close it — the same "prove it empirically first" discipline
 * `actStaleCommitRace.test.ts` already applied to the write-side
 * concurrency gap.
 */
describe('createNursingIdentityProvider snapshot staleness', () => {
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

  it('a stale IdentityProvider snapshot still honors a physician whose credential has since been revoked in the real, current nursing state', () => {
    // Built from the pre-revocation snapshot — exactly what a caller
    // would be holding if they fetched nursing state once and reused it,
    // instead of re-reading it fresh before every approval.
    const staleIdentityProvider = createNursingIdentityProvider(nursingContextBeforeRevocation);

    // Real world: dr-lin's credential gets revoked — for cause, say —
    // sometime after that snapshot was taken.
    const revocationResult = revokeCredentialHandler(nursingContextBeforeRevocation, {
      kind: 'RevokeCredential',
      credentialId: drLinCredentialId,
      revokedAt: nursingIsoTimestamp('2026-07-21T00:00:00.000Z'),
    });
    expect(revocationResult.ok).toBe(true);
    if (!revocationResult.ok) throw new Error('expected ok');
    const currentNursingContext = revocationResult.value.context;

    // A *fresh* provider, built from nursing's actual current state,
    // correctly refuses dr-lin — proving the resolution logic itself is
    // sound; the problem is purely which snapshot a caller happens to be
    // holding.
    const freshIdentityProvider = createNursingIdentityProvider(currentNursingContext);
    const freshResolution = resolveApprovalForProposal(freshIdentityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, dischargeProposal, {
      approverId: 'dr-lin',
      approved: true,
      decidedAt: '2026-07-22T00:00:00.000Z',
    });
    expect(freshResolution.kind).toBe('unresolved');

    // The gap: the *stale* provider — built before the revocation, but
    // consulted after it happened in real time — still resolves dr-lin
    // as a valid physician, and act()/actHuman()'s optimistic-concurrency
    // check does nothing to catch this: OCC re-validates the *domain
    // being committed to* immediately before writing, not the freshness
    // of an IdentityProvider a caller already resolved an approval
    // against beforehand.
    const staleResolution = resolveApprovalForProposal(staleIdentityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, dischargeProposal, {
      approverId: 'dr-lin',
      approved: true,
      decidedAt: '2026-07-22T00:00:00.000Z',
    });
    expect(staleResolution.kind).toBe('resolved');
    if (staleResolution.kind !== 'resolved') throw new Error('expected resolved');
    expect(staleResolution.approval.approverRole).toBe('physician');
  });
});
