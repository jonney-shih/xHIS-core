import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileOutboxCursor } from '../../src/core/io/outboxCursor.js';
import { EXAMPLE_firstAvailableBedStrategy } from '../../src/integration/bedSelection.js';
import { relayPatientEffectsToBed } from '../../src/integration/outboxRelay.js';
import { createFileShell, readCommits } from '../../src/agentic/shell/fileShell.js';
import { bedEngine } from '../../src/instructions/bed/engine.js';
import { bedId, isoTimestamp as bedIsoTimestamp } from '../../src/instructions/bed/ids.js';
import type { BedContext, BedEffect, BedInstruction } from '../../src/instructions/bed/types.js';
import { patientEngine } from '../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../src/instructions/patient/types.js';

let dir: string;
let patientCommitsFile: string;
let bedCommitsFile: string;
let bedAuditFile: string;
let cursorFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-outbox-relay-stale-race-'));
  patientCommitsFile = join(dir, 'patient-commits.jsonl');
  bedCommitsFile = join(dir, 'bed-commits.jsonl');
  bedAuditFile = join(dir, 'bed-audit.jsonl');
  cursorFile = join(dir, 'cursor.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const twoAvailableBeds: BedContext = {
  beds: {
    'bed-1': { bedId: bedId('bed-1'), status: 'available' },
    'bed-2': { bedId: bedId('bed-2'), status: 'available' },
  },
};

function bedShell() {
  return createFileShell<BedContext, BedInstruction, BedEffect>({ commitsFile: bedCommitsFile, auditFile: bedAuditFile });
}

function commitPatientInstructions(context: PatientContext, instructions: readonly PatientInstruction[]): PatientContext {
  const outcome = patientEngine.executeSequence(context, instructions);
  if (!outcome.ok) throw new Error('expected patient instructions to succeed in this test');

  createFileShell<PatientContext, PatientInstruction, PatientEffect>({
    commitsFile: patientCommitsFile,
    auditFile: join(dir, 'patient-audit.jsonl'),
  }).commit(outcome.value.context, outcome.value.effects);

  return outcome.value.context;
}

/**
 * Documents a real, currently-unguarded gap: `relayPatientEffectsToBed`
 * (and every other `outboxRelay*.ts` wrapper around `core/io/relay.ts`'s
 * `relayEffects`) commits via a plain `BedCommitter`/`EffectCommitter` —
 * `commit()` only, no `readLatest()` — so it never re-validates against
 * the bed domain's actual latest committed state the way `act()`/
 * `actHuman()` were fixed to. Bed has two independent writers into the
 * same `bedCommitsFile`: direct `AssignBed`/`ReleaseBed` through the
 * agentic/human pipeline (OCC-protected), and this relay reacting to
 * patient discharge/admission (not protected at all). This test
 * reproduces the second writer racing the first.
 *
 * Asserts the *current*, gapped behavior (it passes today, without any
 * fix) specifically to make the gap concrete before deciding how to
 * close it — the same "prove it empirically first" discipline
 * `actStaleCommitRace.test.ts` already applied to `act()`'s own
 * commit-time staleness.
 */
describe('relayPatientEffectsToBed races a direct AssignBed through the same bedCommitsFile', () => {
  it('the relay\'s stale starting context silently overwrites a bed a direct commit already assigned in the real, current bed state', () => {
    const shell = bedShell();

    // A direct assignment lands first — exactly what act()/actHuman()
    // would produce for some other encounter, entirely unrelated to the
    // admission the relay is about to process below.
    const directAssignOutcome = bedEngine.execute(twoAvailableBeds, {
      kind: 'AssignBed',
      bedId: bedId('bed-1'),
      encounterId: encounterId('encounter-5'),
      assignedAt: bedIsoTimestamp('2026-07-18T00:00:00.000Z'),
    });
    expect(directAssignOutcome.ok).toBe(true);
    if (!directAssignOutcome.ok) throw new Error('expected ok');
    shell.commit(directAssignOutcome.value.context, directAssignOutcome.value.effects);

    // A new patient is admitted, durably, in the patient domain.
    commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-18T00:01:00.000Z') },
    ]);

    // The relay is invoked with `twoAvailableBeds` as its starting
    // context — stale relative to the real, current bed state (which
    // already has bed-1 occupied by encounter-5), exactly what a caller
    // holding an earlier snapshot would pass. Nothing in
    // `relayPatientEffectsToBed`/`relayEffects` re-reads the real latest
    // state before committing.
    const result = relayPatientEffectsToBed(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      shell,
      bedEngine,
      twoAvailableBeds,
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-18T00:02:00.000Z'),
    );

    // The bug: the relay's stale view thinks bed-1 is available, assigns
    // it to encounter-1, and commits that — silently erasing
    // encounter-5's already-real, already-committed occupancy of bed-1.
    expect(result.outcomes).toEqual([{ kind: 'assigned', encounterId: 'encounter-1', bedId: 'bed-1' }]);

    const commits = readCommits<BedContext, BedEffect>(bedCommitsFile);
    const latest = commits[commits.length - 1]!.context;

    // What the real, current bed state should say: bed-1 still occupied
    // by encounter-5, bed-2 now occupied by encounter-1 (the only
    // genuinely available bed). What it actually says, because of this
    // gap: bed-1 reassigned to encounter-1, encounter-5's occupancy gone
    // without a trace.
    expect(latest.beds['bed-1']).toMatchObject({ status: 'occupied', encounterId: 'encounter-1' });
  });
});
