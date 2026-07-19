import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileShell, readAuditLog, readCommits, readLatestContext } from '../../../src/agentic/shell/fileShell.js';
import type { FileShellPaths } from '../../../src/agentic/shell/fileShell.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../../src/instructions/patient/types.js';

let dir: string;
let paths: FileShellPaths;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-file-shell-'));
  paths = { commitsFile: join(dir, 'commits.jsonl'), auditFile: join(dir, 'audit.jsonl') };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

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

const admittedEffect: PatientEffect = {
  kind: 'EncounterAdmitted',
  encounterId: encounterId('encounter-1'),
  patientId: patientId('patient-1'),
  admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
};

const proposal: PlanProposal<PatientInstruction> = {
  instructions: [],
  rationale: 'test',
  modelVersion: 'stub-v0',
  promptVersion: 'stub-v0',
  proposedAt: '2026-07-19T00:00:00.000Z',
};

describe('createFileShell', () => {
  it('persists a commit to disk and reads it back', () => {
    const shell = createFileShell<PatientContext, PatientInstruction, PatientEffect>(paths);

    shell.commit(admittedContext, [admittedEffect]);

    expect(readCommits<PatientContext, PatientEffect>(paths.commitsFile)).toEqual([
      { context: admittedContext, effects: [admittedEffect] },
    ]);
  });

  it('persists an audit record to disk and reads it back', () => {
    const shell = createFileShell<PatientContext, PatientInstruction, PatientEffect>(paths);

    shell.recordAudit({
      proposal,
      decision: { kind: 'accept' },
      commitOutcome: 'committed',
      reasons: [],
      effects: [admittedEffect],
      recordedAt: '2026-07-19T00:00:01.000Z',
    });

    const auditLog = readAuditLog<PatientInstruction, PatientEffect>(paths.auditFile);
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0]).toMatchObject({ commitOutcome: 'committed' });
  });

  it('appends multiple commits in order rather than overwriting', () => {
    const shell = createFileShell<PatientContext, PatientInstruction, PatientEffect>(paths);
    const emptyContext: PatientContext = { encounters: {} };

    shell.commit(emptyContext, []);
    shell.commit(admittedContext, [admittedEffect]);

    const commits = readCommits<PatientContext, PatientEffect>(paths.commitsFile);
    expect(commits).toHaveLength(2);
    expect(commits[0]!.context).toEqual(emptyContext);
    expect(commits[1]!.context).toEqual(admittedContext);
  });

  it('readLatestContext returns the most recently committed context', () => {
    const shell = createFileShell<PatientContext, PatientInstruction, PatientEffect>(paths);
    const emptyContext: PatientContext = { encounters: {} };

    shell.commit(emptyContext, []);
    shell.commit(admittedContext, [admittedEffect]);

    expect(readLatestContext<PatientContext>(paths.commitsFile)).toEqual(admittedContext);
  });

  it('readLatestContext returns undefined when nothing has ever been committed', () => {
    expect(readLatestContext<PatientContext>(paths.commitsFile)).toBeUndefined();
  });

  it('read helpers return an empty array when the file does not exist yet', () => {
    expect(readCommits(paths.commitsFile)).toEqual([]);
    expect(readAuditLog(paths.auditFile)).toEqual([]);
  });

  it('creates parent directories that do not exist yet', () => {
    const nestedPaths: FileShellPaths = {
      commitsFile: join(dir, 'nested', 'deeper', 'commits.jsonl'),
      auditFile: join(dir, 'nested', 'deeper', 'audit.jsonl'),
    };

    const shell = createFileShell<PatientContext, PatientInstruction, PatientEffect>(nestedPaths);
    shell.commit(admittedContext, [admittedEffect]);

    expect(readCommits<PatientContext, PatientEffect>(nestedPaths.commitsFile)).toHaveLength(1);
  });

  it('throws rather than silently skipping a corrupted line on read', () => {
    appendFileSync(paths.commitsFile, 'not valid json\n', 'utf8');

    expect(() => readCommits(paths.commitsFile)).toThrow();
  });
});
