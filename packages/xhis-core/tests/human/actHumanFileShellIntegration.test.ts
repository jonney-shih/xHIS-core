import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actHuman } from '../../src/human/actHuman.js';
import { createFileShell, readAuditLog, readCommits } from '../../src/agentic/shell/fileShell.js';
import type { FileShellPaths } from '../../src/agentic/shell/fileShell.js';
import type { HumanActionAuditRecord } from '../../src/human/humanActionAuditRecord.js';
import { resolveActorForInstructions } from '../../src/agentic/identity/resolveActorForInstructions.js';
import { createInMemoryIdentityProvider } from '../../src/agentic/identity/inMemoryIdentityProvider.js';
import { patientRiskTiers } from '../../src/agentic/risk/patient.js';
import { EXAMPLE_patientApprovalPolicy } from '../../src/agentic/identity/patient.js';
import { patientEngine } from '../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../src/instructions/patient/types.js';

let dir: string;
let paths: FileShellPaths;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-human-file-shell-'));
  paths = { commitsFile: join(dir, 'commits.jsonl'), auditFile: join(dir, 'audit.jsonl') };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * The actual claim `shell.ts`'s doc comment makes about `ImperativeShell`
 * — "nothing about it cares where a commit came from" — proven against a
 * second real caller, not just asserted: `createFileShell`, already
 * exercised by `act()` in `fileShellActIntegration.test.ts`, is reused
 * here unmodified for `actHuman()`, just with `HumanActionAuditRecord`
 * as its `TAuditRecord` type argument instead of the default
 * `AuditRecord`.
 */
describe('actHuman() against createFileShell', () => {
  const emptyContext: PatientContext = { encounters: {} };
  const admit: PatientInstruction = {
    kind: 'AdmitPatient',
    patientId: patientId('patient-1'),
    encounterId: encounterId('encounter-1'),
    admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
  };

  const identityProvider = createInMemoryIdentityProvider([
    { id: 'dr-chen', displayName: 'Dr. Chen', roles: ['physician'] },
    { id: 'nurse-wu', displayName: 'Nurse Wu', roles: ['charge-nurse'] },
  ]);

  it('a real physician directly admits a patient, and the commit and audit trail both survive on disk', () => {
    const shell = createFileShell<PatientContext, PatientInstruction, PatientEffect, HumanActionAuditRecord<PatientInstruction, PatientEffect>>(
      paths,
    );

    const authorization = resolveActorForInstructions(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, [admit], {
      actorId: 'dr-chen',
      assertedAt: '2026-07-18T00:00:01.000Z',
    });
    expect(authorization.kind).toBe('resolved');

    const outcome = actHuman(shell, {
      instructions: [admit],
      baselineContext: emptyContext,
      reexecute: (ctx) => patientEngine.executeSequence(ctx, [admit]),
      authorization,
      recordedAt: '2026-07-18T00:00:02.000Z',
    });

    expect(outcome).toBe('committed');
    expect(readCommits(paths.commitsFile)).toHaveLength(1);

    const auditLog = readAuditLog<PatientInstruction, PatientEffect, HumanActionAuditRecord<PatientInstruction, PatientEffect>>(
      paths.auditFile,
    );
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0]).toMatchObject({ outcome: 'committed', actor: { approverId: 'dr-chen', approverRole: 'physician' } });
  });

  it('a charge-nurse — sufficient to directly admit — cannot directly discharge; nothing is written to either file', () => {
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
    const discharge: PatientInstruction = {
      kind: 'DischargePatient',
      encounterId: encounterId('encounter-1'),
      dischargedAt: isoTimestamp('2026-07-18T02:00:00.000Z'),
    };

    const shell = createFileShell<PatientContext, PatientInstruction, PatientEffect, HumanActionAuditRecord<PatientInstruction, PatientEffect>>(
      paths,
    );

    const authorization = resolveActorForInstructions(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, [discharge], {
      actorId: 'nurse-wu',
      assertedAt: '2026-07-18T02:00:01.000Z',
    });
    expect(authorization.kind).toBe('unresolved');

    const outcome = actHuman(shell, {
      instructions: [discharge],
      baselineContext: admittedContext,
      reexecute: (ctx) => patientEngine.executeSequence(ctx, [discharge]),
      authorization,
      recordedAt: '2026-07-18T02:00:02.000Z',
    });

    expect(outcome).toBe('unauthorized');
    expect(readCommits(paths.commitsFile)).toEqual([]);

    const auditLog = readAuditLog<PatientInstruction, PatientEffect, HumanActionAuditRecord<PatientInstruction, PatientEffect>>(
      paths.auditFile,
    );
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0]).toMatchObject({ outcome: 'unauthorized' });
  });
});
