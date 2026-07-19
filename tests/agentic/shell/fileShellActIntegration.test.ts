import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createFileShell, readAuditLog, readCommits } from '../../../src/agentic/shell/fileShell.js';
import type { FileShellPaths } from '../../../src/agentic/shell/fileShell.js';
import { patientEngine } from '../../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext, PatientInstruction } from '../../../src/instructions/patient/types.js';

let dir: string;
let paths: FileShellPaths;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-file-shell-act-'));
  paths = { commitsFile: join(dir, 'commits.jsonl'), auditFile: join(dir, 'audit.jsonl') };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * `createFileShell` is a drop-in `ImperativeShell` — this re-runs `act()`'s
 * own accept/reject scenarios (see `act.test.ts`) against the file-backed
 * shell instead of the in-memory one, reading results back off disk
 * afterward rather than off an in-memory array.
 */
describe('act() against createFileShell', () => {
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

  it('commits to disk and writes a matching audit record when Check accepts', () => {
    const shell = createFileShell(paths);
    const doOutcome = patientEngine.executeSequence(emptyContext, proposal.instructions);

    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision: { kind: 'accept' },
      recordedAt: '2026-07-19T00:00:01.000Z',
    });

    expect(outcome).toBe('committed');
    expect(readCommits(paths.commitsFile)).toHaveLength(1);
    expect(readAuditLog(paths.auditFile)).toHaveLength(1);
    expect(readAuditLog(paths.auditFile)[0]).toMatchObject({ commitOutcome: 'committed' });
  });

  it('writes an audit record but nothing to the commits file when Check rejects', () => {
    const shell = createFileShell(paths);
    const doOutcome = patientEngine.executeSequence(emptyContext, proposal.instructions);

    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision: { kind: 'reject', reasons: ['business rule violated'] },
      recordedAt: '2026-07-19T00:00:01.000Z',
    });

    expect(outcome).toBe('rejected');
    expect(readCommits(paths.commitsFile)).toEqual([]);
    expect(readAuditLog(paths.auditFile)).toHaveLength(1);
  });

  it('accumulates audit records across repeated calls, surviving as separate shell instances would', () => {
    const doOutcome = patientEngine.executeSequence(emptyContext, proposal.instructions);

    act(createFileShell(paths), { proposal, doOutcome, decision: { kind: 'accept' }, recordedAt: '2026-07-19T00:00:01.000Z' });
    act(createFileShell(paths), {
      proposal,
      doOutcome,
      decision: { kind: 'reject', reasons: ['second attempt rejected'] },
      recordedAt: '2026-07-19T00:00:02.000Z',
    });

    expect(readAuditLog(paths.auditFile)).toHaveLength(2);
  });
});
