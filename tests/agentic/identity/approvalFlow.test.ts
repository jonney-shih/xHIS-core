import { describe, expect, it } from 'vitest';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApproval } from '../../../src/agentic/identity/resolveApproval.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import { patientEngine } from '../../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../../src/instructions/patient/types.js';

/**
 * Exercises identity verification and Act together, the way a real caller
 * would compose them: Check says `needs-human-approval` -> someone submits
 * a raw claim -> `resolveApproval` verifies it -> only a *resolved* claim
 * ever becomes an `Approval` `act()` will honor.
 */
describe('resolveApproval + act composed end to end', () => {
  const identityProvider = createInMemoryIdentityProvider([
    { id: 'dr-chen', displayName: 'Dr. Chen', roles: ['clinical-approver'] },
  ]);

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

  const admittedContext: PatientContext = {
    encounters: {
      'encounter-1': {
        encounterId: encounterId('encounter-1'),
        patientId: patientId('patient-1'),
        status: 'admitted',
        admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
      },
    },
  };

  function newShell() {
    return createInMemoryShell<PatientContext, PatientInstruction, PatientEffect>();
  }

  it('commits once a verified, permitted identity approves', () => {
    const shell = newShell();
    const doOutcome = patientEngine.executeSequence(admittedContext, proposal.instructions);

    const resolution = resolveApproval(identityProvider, ['clinical-approver'], {
      approverId: 'dr-chen',
      approved: true,
      decidedAt: '2026-07-19T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') throw new Error('expected resolved');

    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision: { kind: 'needs-human-approval', reasons: ["risk tier 'approval-required'"] },
      approval: resolution.approval,
      recordedAt: '2026-07-19T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
  });

  it('an impersonation attempt never produces an Approval for act() to honor', () => {
    const shell = newShell();
    const doOutcome = patientEngine.executeSequence(admittedContext, proposal.instructions);

    const resolution = resolveApproval(identityProvider, ['clinical-approver'], {
      approverId: 'someone-pretending-to-be-dr-chen',
      approved: true,
      decidedAt: '2026-07-19T00:05:00.000Z',
    });
    expect(resolution.kind).toBe('unresolved');

    // There is nothing to hand act() — the impersonation attempt stays
    // `awaiting-approval`, same as if no one had responded at all.
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision: { kind: 'needs-human-approval', reasons: ["risk tier 'approval-required'"] },
      recordedAt: '2026-07-19T00:05:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
  });
});
