import { describe, expect, it } from 'vitest';
import { actHuman } from '../../src/human/actHuman.js';
import { createInMemoryShell } from '../../src/agentic/shell/inMemoryShell.js';
import type { HumanActionAuditRecord } from '../../src/human/humanActionAuditRecord.js';
import type { ApprovalResolution } from '../../src/agentic/identity/resolveApproval.js';
import { patientEngine } from '../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../src/instructions/patient/types.js';

const emptyContext: PatientContext = { encounters: {} };

const admit: PatientInstruction = {
  kind: 'AdmitPatient',
  patientId: patientId('patient-1'),
  encounterId: encounterId('encounter-1'),
  admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
};

function newShell() {
  return createInMemoryShell<PatientContext, PatientInstruction, PatientEffect, HumanActionAuditRecord<PatientInstruction, PatientEffect>>();
}

function reexecute(ctx: PatientContext) {
  return patientEngine.executeSequence(ctx, [admit]);
}

const resolvedAsChargeNurse: ApprovalResolution = {
  kind: 'resolved',
  approval: { approverId: 'nurse-wu', approverRole: 'charge-nurse', approved: true, decidedAt: '2026-07-18T00:00:01.000Z' },
};

const unresolved: ApprovalResolution = {
  kind: 'unresolved',
  reason: "identity 'nurse-lin' holds none of the required roles [physician, charge-nurse]",
};

describe('actHuman', () => {
  it('commits directly when the actor is authorized and the sequence executes cleanly', () => {
    const shell = newShell();

    const outcome = actHuman(shell, {
      instructions: [admit],
      baselineContext: emptyContext,
      reexecute,
      authorization: resolvedAsChargeNurse,
      recordedAt: '2026-07-18T00:00:02.000Z',
    });

    expect(outcome).toBe('committed');
    expect(shell.commits).toHaveLength(1);
    expect(shell.commits[0]!.context.encounters['encounter-1']).toMatchObject({ status: 'admitted' });
    expect(shell.auditLog[0]).toMatchObject({
      outcome: 'committed',
      reasons: [],
      actor: { approverId: 'nurse-wu', approverRole: 'charge-nurse' },
    });
    expect(shell.auditLog[0]!.effects).toEqual([
      { kind: 'EncounterAdmitted', encounterId: 'encounter-1', patientId: 'patient-1', admittedAt: '2026-07-18T00:00:00.000Z' },
    ]);
  });

  it('never commits when the actor is unauthorized, and records why without an actor on the audit entry', () => {
    const shell = newShell();

    const outcome = actHuman(shell, {
      instructions: [admit],
      baselineContext: emptyContext,
      reexecute,
      authorization: unresolved,
      recordedAt: '2026-07-18T00:00:02.000Z',
    });

    expect(outcome).toBe('unauthorized');
    expect(shell.commits).toHaveLength(0);
    expect(shell.auditLog[0]).toEqual({
      instructions: [admit],
      outcome: 'unauthorized',
      reasons: ["identity 'nurse-lin' holds none of the required roles [physician, charge-nurse]"],
      effects: [],
      actor: undefined,
      recordedAt: '2026-07-18T00:00:02.000Z',
    });
  });

  it('rejects, without committing, when the freshly re-executed sequence fails even though the actor is authorized', () => {
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

    const outcome = actHuman(shell, {
      instructions: [admit],
      baselineContext: alreadyAdmittedContext,
      reexecute,
      authorization: resolvedAsChargeNurse,
      recordedAt: '2026-07-18T00:00:02.000Z',
    });

    expect(outcome).toBe('rejected');
    expect(shell.commits).toHaveLength(0);
    expect(shell.auditLog[0]).toMatchObject({
      outcome: 'rejected',
      reasons: ['instruction sequence failed at index 0'],
      actor: { approverId: 'nurse-wu', approverRole: 'charge-nurse' },
    });
  });

  it('re-derives what to commit from shell.readLatest(), not baselineContext, once something else has already committed', () => {
    const shell = newShell();

    // Simulates another actor having already admitted this same encounter
    // through this same shell, between when this caller's baseline was
    // taken and now — the same race actStaleCommitRace.test.ts proves
    // act() closes, exercised here for actHuman() instead.
    shell.commit(
      {
        encounters: {
          'encounter-1': {
            encounterId: encounterId('encounter-1'),
            patientId: patientId('patient-1'),
            status: 'admitted',
            admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
          },
        },
      },
      [],
    );

    const outcome = actHuman(shell, {
      instructions: [admit],
      baselineContext: emptyContext, // stale: unaware of the commit above
      reexecute,
      authorization: resolvedAsChargeNurse,
      recordedAt: '2026-07-18T00:00:02.000Z',
    });

    expect(outcome).toBe('rejected');
    expect(shell.commits).toHaveLength(1);
  });
});
