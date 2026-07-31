import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createSqliteShell, readSqliteAuditLog, readSqliteCommits } from '../../../src/agentic/shell/sqliteShell.js';
import { patientEngine } from '../../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../../src/instructions/patient/types.js';

let dir: string;
let databasePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-sqlite-shell-act-'));
  databasePath = join(dir, 'shell.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * `createSqliteShell` is a drop-in `ImperativeShell`, exactly the claim
 * `createFileShell`'s own equivalent test proves for the file-backed
 * shell — re-runs `act()`'s own accept/reject scenarios against a real
 * SQL database instead, with zero changes to `act()` itself. This is
 * the actual point of building this adapter: proving the seam already
 * built for it needed nothing new to support a genuinely different
 * backing store.
 */
describe('act() against createSqliteShell', () => {
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

  function reexecute(ctx: PatientContext) {
    return patientEngine.executeSequence(ctx, proposal.instructions);
  }

  it('commits to the database and writes a matching audit record when Check accepts', () => {
    const shell = createSqliteShell<PatientContext, PatientInstruction, PatientEffect>(databasePath);
    const doOutcome = patientEngine.executeSequence(emptyContext, proposal.instructions);

    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision: { kind: 'accept' },
      baselineContext: emptyContext,
      reexecute,
      recordedAt: '2026-07-19T00:00:01.000Z',
    });
    shell.close();

    expect(outcome).toBe('committed');
    expect(readSqliteCommits(databasePath)).toHaveLength(1);
    expect(readSqliteAuditLog(databasePath)).toHaveLength(1);
    expect(readSqliteAuditLog(databasePath)[0]).toMatchObject({ commitOutcome: 'committed' });
  });

  it('writes an audit record but nothing to the commits table when Check rejects', () => {
    const shell = createSqliteShell<PatientContext, PatientInstruction, PatientEffect>(databasePath);
    const doOutcome = patientEngine.executeSequence(emptyContext, proposal.instructions);

    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision: { kind: 'reject', reasons: ['business rule violated'] },
      baselineContext: emptyContext,
      reexecute,
      recordedAt: '2026-07-19T00:00:01.000Z',
    });
    shell.close();

    expect(outcome).toBe('rejected');
    expect(readSqliteCommits(databasePath)).toEqual([]);
    expect(readSqliteAuditLog(databasePath)).toHaveLength(1);
  });

  it('re-derives against readLatest() before committing, the same OCC guarantee proven for every other ImperativeShell', () => {
    const shell = createSqliteShell<PatientContext, PatientInstruction, PatientEffect>(databasePath);

    // Something else commits directly to the same database first --
    // exactly what act()'s own staleness re-check exists to notice.
    shell.commit(
      { encounters: { 'encounter-1': { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1'), status: 'admitted', admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z') } } },
      [],
    );

    const doOutcome = patientEngine.executeSequence(emptyContext, proposal.instructions); // dry-run against the now-stale emptyContext
    const outcome = act(shell, {
      proposal,
      doOutcome,
      decision: { kind: 'accept' },
      baselineContext: emptyContext,
      reexecute,
      recordedAt: '2026-07-19T00:00:01.000Z',
    });
    shell.close();

    // The fresh re-check against readLatest() (already-admitted
    // encounter-1) correctly fails the second AdmitPatient, so nothing
    // duplicate ever gets committed.
    expect(outcome).toBe('stale');
    expect(readSqliteCommits(databasePath)).toHaveLength(1); // only the direct commit above
  });
});
