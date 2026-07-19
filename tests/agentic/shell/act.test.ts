import { describe, expect, it } from 'vitest';
import { act } from '../../../src/agentic/shell/act.js';
import { createInMemoryShell } from '../../../src/agentic/shell/inMemoryShell.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { patientEngine } from '../../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../../src/instructions/patient/types.js';

const emptyContext: PatientContext = { encounters: {} };

const admit: PatientInstruction = {
  kind: 'AdmitPatient',
  patientId: patientId('patient-1'),
  encounterId: encounterId('encounter-1'),
  admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
};

const proposal: PlanProposal<PatientInstruction> = {
  instructions: [admit],
  rationale: 'test proposal',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-07-19T00:00:00.000Z',
};

function newShell() {
  return createInMemoryShell<PatientContext, PatientInstruction, PatientEffect>();
}

describe('act', () => {
  it('commits and records an audit entry when Check accepts', () => {
    const shell = newShell();
    const doOutcome = patientEngine.executeSequence(emptyContext, proposal.instructions);

    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision: { kind: 'accept' },
      recordedAt: '2026-07-19T00:00:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toEqual([
      {
        context: { encounters: { 'encounter-1': expect.objectContaining({ status: 'admitted' }) } },
        effects: [
          {
            kind: 'EncounterAdmitted',
            encounterId: 'encounter-1',
            patientId: 'patient-1',
            admittedAt: '2026-07-18T00:00:00.000Z',
          },
        ],
      },
    ]);
    expect(shell.auditLog).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({ commitOutcome: 'committed', reasons: [] });
  });

  it('does not commit when Check rejects', () => {
    const shell = newShell();
    const doOutcome = patientEngine.executeSequence(emptyContext, proposal.instructions);

    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision: { kind: 'reject', reasons: ['business rule violated'] },
      recordedAt: '2026-07-19T00:00:01.000Z',
    });

    expect(outcome).toBe('rejected');
    expect(shell.commits).toHaveLength(0);
    expect(shell.auditLog[0]).toMatchObject({ commitOutcome: 'rejected', reasons: ['business rule violated'] });
  });

  it('is awaiting-approval when Check needs a human and none has decided yet', () => {
    const shell = newShell();
    const doOutcome = patientEngine.executeSequence(emptyContext, proposal.instructions);

    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision: { kind: 'needs-human-approval', reasons: ["risk tier 'approval-required'"] },
      recordedAt: '2026-07-19T00:00:01.000Z',
    });

    expect(outcome).toBe('awaiting-approval');
    expect(shell.commits).toHaveLength(0);
    expect(shell.auditLog[0]).toMatchObject({ commitOutcome: 'awaiting-approval' });
  });

  it('commits once a human approves', () => {
    const shell = newShell();
    const doOutcome = patientEngine.executeSequence(emptyContext, proposal.instructions);

    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision: { kind: 'needs-human-approval', reasons: ["risk tier 'approval-required'"] },
      approval: { approverId: 'dr-chen', approverRole: 'clinical-approver', approved: true, decidedAt: '2026-07-19T00:05:00.000Z' },
      recordedAt: '2026-07-19T00:05:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.auditLog[0]).toMatchObject({
      commitOutcome: 'committed',
      approval: { approverId: 'dr-chen', approverRole: 'clinical-approver', approved: true },
    });
  });

  it('rejects when a human declines approval', () => {
    const shell = newShell();
    const doOutcome = patientEngine.executeSequence(emptyContext, proposal.instructions);

    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision: { kind: 'needs-human-approval', reasons: ["risk tier 'approval-required'"] },
      approval: { approverId: 'dr-chen', approverRole: 'clinical-approver', approved: false, decidedAt: '2026-07-19T00:05:00.000Z' },
      recordedAt: '2026-07-19T00:05:01.000Z',
    });

    expect(outcome).toBe('rejected');
    expect(shell.commits).toHaveLength(0);
    expect(shell.auditLog[0]?.reasons).toEqual(['rejected by approver dr-chen']);
  });

  it('never commits when the dry run itself failed, regardless of decision', () => {
    const shell = newShell();
    const alreadyAdmittedContext: PatientContext = {
      encounters: {
        'encounter-1': {
          encounterId: encounterId('encounter-1'),
          patientId: patientId('patient-1'),
          status: 'admitted',
          admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
        },
      },
    };
    const doOutcome = patientEngine.executeSequence(alreadyAdmittedContext, proposal.instructions);

    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision: { kind: 'accept' },
      recordedAt: '2026-07-19T00:00:01.000Z',
    });

    expect(outcome).toBe('rejected');
    expect(shell.commits).toHaveLength(0);
    expect(shell.auditLog[0]?.reasons).toEqual(['dry run failed at instruction 0']);
  });
});
