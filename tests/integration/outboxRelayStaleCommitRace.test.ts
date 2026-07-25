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
 * Originally documented a real, then-unguarded gap: `relayPatientEffectsToBed`
 * (and every `outboxRelay*.ts` wrapper around `core/io/relay.ts`'s
 * `relayEffects`) used to commit via a plain `BedCommitter`/`EffectCommitter` —
 * `commit()` only, no `readLatest()` — so it never re-validated against
 * bed's actual latest committed state before writing, even though a
 * direct `AssignBed`/`ReleaseBed` through the agentic/human pipeline
 * writes into the exact same `bedCommitsFile`. Now that `EffectCommitter`
 * requires `readLatest()` and `relayEffects` re-derives `react`'s result
 * against `targetCommitter.readLatest() ?? context` immediately before
 * each commit (see `relay.ts`), this file proves the fix closes the race
 * rather than merely describing it.
 */
describe('relayPatientEffectsToBed re-validates against the real bed state before each commit', () => {
  it('a direct AssignBed that lands before the relay commits is never overwritten — the relay sees it and picks a different bed', () => {
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
    // already has bed-1 occupied by encounter-5) — exactly what a
    // caller holding an earlier snapshot would pass. The fix: it no
    // longer trusts that snapshot once something newer is on record.
    const result = relayPatientEffectsToBed(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      shell,
      bedEngine,
      twoAvailableBeds,
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-18T00:02:00.000Z'),
    );

    // The relay correctly sees bed-1 is already occupied and assigns
    // bed-2 instead — not because `twoAvailableBeds` said so, but
    // because it re-read the real latest state before reacting.
    expect(result.outcomes).toEqual([{ kind: 'assigned', encounterId: 'encounter-1', bedId: 'bed-2' }]);

    const commits = readCommits<BedContext, BedEffect>(bedCommitsFile);
    const latest = commits[commits.length - 1]!.context;

    // Both assignments survive: encounter-5's direct one, untouched,
    // and encounter-1's new one — proving the fix doesn't just avoid
    // committing garbage, it correctly merges with what changed
    // underneath it.
    expect(latest.beds['bed-1']).toMatchObject({ status: 'occupied', encounterId: 'encounter-5' });
    expect(latest.beds['bed-2']).toMatchObject({ status: 'occupied', encounterId: 'encounter-1' });
  });

  it('reports no-bed-available, rather than overwriting anything, when the real current state leaves nothing free', () => {
    const shell = bedShell();

    // Both beds get directly occupied by other encounters after the
    // relay's caller would have taken its (now stale) starting snapshot.
    const firstAssign = bedEngine.execute(twoAvailableBeds, {
      kind: 'AssignBed',
      bedId: bedId('bed-1'),
      encounterId: encounterId('encounter-5'),
      assignedAt: bedIsoTimestamp('2026-07-18T00:00:00.000Z'),
    });
    expect(firstAssign.ok).toBe(true);
    if (!firstAssign.ok) throw new Error('expected ok');
    shell.commit(firstAssign.value.context, firstAssign.value.effects);

    const secondAssign = bedEngine.execute(firstAssign.value.context, {
      kind: 'AssignBed',
      bedId: bedId('bed-2'),
      encounterId: encounterId('encounter-6'),
      assignedAt: bedIsoTimestamp('2026-07-18T00:00:30.000Z'),
    });
    expect(secondAssign.ok).toBe(true);
    if (!secondAssign.ok) throw new Error('expected ok');
    shell.commit(secondAssign.value.context, secondAssign.value.effects);

    commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-18T00:01:00.000Z') },
    ]);

    const result = relayPatientEffectsToBed(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      shell,
      bedEngine,
      twoAvailableBeds,
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-18T00:02:00.000Z'),
    );

    expect(result.outcomes).toEqual([{ kind: 'no-bed-available', encounterId: 'encounter-1' }]);

    const commits = readCommits<BedContext, BedEffect>(bedCommitsFile);
    expect(commits).toHaveLength(2); // only the two direct assignments — the relay committed nothing
    const latest = commits[commits.length - 1]!.context;
    expect(latest.beds['bed-1']).toMatchObject({ status: 'occupied', encounterId: 'encounter-5' });
    expect(latest.beds['bed-2']).toMatchObject({ status: 'occupied', encounterId: 'encounter-6' });
  });
});
