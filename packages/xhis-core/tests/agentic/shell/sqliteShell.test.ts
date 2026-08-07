import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteShell, readSqliteAuditLog, readSqliteCommits } from '../../../src/agentic/shell/sqliteShell.js';

// See sqliteShell.ts's own doc comment: a static `import ... from
// 'node:sqlite'` fails under Vitest's Vite-based transform, so this
// test (which needs direct DB access to stage a corrupted row) uses
// the same createRequire workaround the implementation does.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../../src/instructions/patient/types.js';

let dir: string;
let databasePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-sqlite-shell-'));
  databasePath = join(dir, 'shell.db');
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

describe('createSqliteShell', () => {
  it('persists a commit to the database and reads it back', () => {
    const shell = createSqliteShell<PatientContext, PatientInstruction, PatientEffect>(databasePath);

    shell.commit(admittedContext, [admittedEffect]);
    shell.close();

    expect(readSqliteCommits<PatientContext, PatientEffect>(databasePath)).toEqual([
      { context: admittedContext, effects: [admittedEffect] },
    ]);
  });

  it('persists an audit record to the database and reads it back', () => {
    const shell = createSqliteShell<PatientContext, PatientInstruction, PatientEffect>(databasePath);

    shell.recordAudit({
      proposal,
      decision: { kind: 'accept' },
      commitOutcome: 'committed',
      reasons: [],
      effects: [admittedEffect],
      recordedAt: '2026-07-19T00:00:01.000Z',
    });
    shell.close();

    const auditLog = readSqliteAuditLog<PatientInstruction, PatientEffect>(databasePath);
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0]).toMatchObject({ commitOutcome: 'committed' });
  });

  it('appends multiple commits in order rather than overwriting', () => {
    const shell = createSqliteShell<PatientContext, PatientInstruction, PatientEffect>(databasePath);
    const emptyContext: PatientContext = { encounters: {} };

    shell.commit(emptyContext, []);
    shell.commit(admittedContext, [admittedEffect]);
    shell.close();

    const commits = readSqliteCommits<PatientContext, PatientEffect>(databasePath);
    expect(commits).toHaveLength(2);
    expect(commits[0]!.context).toEqual(emptyContext);
    expect(commits[1]!.context).toEqual(admittedContext);
  });

  it('readLatest returns the most recently committed context', () => {
    const shell = createSqliteShell<PatientContext, PatientInstruction, PatientEffect>(databasePath);
    const emptyContext: PatientContext = { encounters: {} };

    shell.commit(emptyContext, []);
    shell.commit(admittedContext, [admittedEffect]);

    expect(shell.readLatest()).toEqual(admittedContext);
    shell.close();
  });

  it('readLatest returns undefined when nothing has ever been committed', () => {
    const shell = createSqliteShell<PatientContext, PatientInstruction, PatientEffect>(databasePath);
    expect(shell.readLatest()).toBeUndefined();
    shell.close();
  });

  it('read helpers return an empty array against a freshly created, empty database', () => {
    createSqliteShell<PatientContext, PatientInstruction, PatientEffect>(databasePath).close();

    expect(readSqliteCommits(databasePath)).toEqual([]);
    expect(readSqliteAuditLog(databasePath)).toEqual([]);
  });

  it('persists across a fresh createSqliteShell instance pointed at the same file — real durability, not just in-process memory', () => {
    const first = createSqliteShell<PatientContext, PatientInstruction, PatientEffect>(databasePath);
    first.commit(admittedContext, [admittedEffect]);
    first.close(); // SQLite holds the file open until closed — required on Windows before a second handle (or a later rmSync) can touch it.

    // A brand-new process reopening the same database file must see
    // the same commit — the actual claim "real deployment needs a
    // production-grade store" is checking, not just "an object stays
    // alive for the duration of one test."
    const reopened = createSqliteShell<PatientContext, PatientInstruction, PatientEffect>(databasePath);
    expect(reopened.readLatest()).toEqual(admittedContext);
    reopened.close();
  });

  it('throws rather than silently skipping a row whose payload is not valid JSON', () => {
    createSqliteShell<PatientContext, PatientInstruction, PatientEffect>(databasePath).close();

    // Corrupt a row directly, the same way fileShell.test.ts corrupts a
    // raw JSON Lines line — bypassing the shell's own writer entirely.
    const db = new DatabaseSync(databasePath);
    db.prepare('INSERT INTO commits (payload) VALUES (?)').run('not valid json');
    db.close();

    expect(() => readSqliteCommits(databasePath)).toThrow();
  });
});
