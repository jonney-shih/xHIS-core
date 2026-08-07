import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileOutboxCursor } from '../../src/core/io/outboxCursor.js';
import { EXAMPLE_firstAvailableBedStrategy } from '../../src/integration/bedSelection.js';
import { EXAMPLE_allOrNothingSagaPolicy, reactToPatientEffectsAsSaga } from '../../src/integration/patientBedSaga.js';
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
let bedAuditFile: string; // createFileShell requires a path even though this relay never reads audit
let cursorFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-outbox-relay-'));
  patientCommitsFile = join(dir, 'patient-commits.jsonl');
  bedCommitsFile = join(dir, 'bed-commits.jsonl');
  bedAuditFile = join(dir, 'bed-audit.jsonl');
  cursorFile = join(dir, 'cursor.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const emptyBedContext: BedContext = {
  beds: {
    'bed-1': { bedId: bedId('bed-1'), status: 'available' },
    'bed-2': { bedId: bedId('bed-2'), status: 'available' },
  },
};

function bedShell() {
  return createFileShell<BedContext, BedInstruction, BedEffect>({ commitsFile: bedCommitsFile, auditFile: bedAuditFile });
}

/** Mimics what a real caller of `act()` does: run patient instructions,
 * then durably commit the resulting effects the same way the agentic
 * shell would. */
function commitPatientInstructions(context: PatientContext, instructions: readonly PatientInstruction[]): PatientContext {
  const outcome = patientEngine.executeSequence(context, instructions);
  if (!outcome.ok) throw new Error('expected patient instructions to succeed in this test');

  createFileShell<PatientContext, PatientInstruction, PatientEffect>({
    commitsFile: patientCommitsFile,
    auditFile: join(dir, 'patient-audit.jsonl'),
  }).commit(outcome.value.context, outcome.value.effects);

  return outcome.value.context;
}

describe('relayPatientEffectsToBed', () => {
  it('processes a durably committed admission and durably commits the bed assignment', () => {
    commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z') },
    ]);

    const result = relayPatientEffectsToBed(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      bedShell(),
      bedEngine,
      emptyBedContext,
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-18T00:01:00.000Z'),
    );

    expect(result.outcomes).toEqual([{ kind: 'assigned', encounterId: 'encounter-1', bedId: 'bed-1' }]);
    expect(result.processedThroughIndex).toBe(1);
    expect(readCommits(bedCommitsFile)).toHaveLength(1);
  });

  it('running again with no new patient commits processes nothing new', () => {
    commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z') },
    ]);

    const cursor = createFileOutboxCursor(cursorFile);
    const first = relayPatientEffectsToBed(patientCommitsFile, cursor, bedShell(), bedEngine, emptyBedContext, EXAMPLE_firstAvailableBedStrategy, bedIsoTimestamp('2026-07-18T00:01:00.000Z'));

    // A fresh cursor/shell instance, as a restarted process would create.
    const second = relayPatientEffectsToBed(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      bedShell(),
      bedEngine,
      first.context,
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-18T00:02:00.000Z'),
    );

    expect(second.outcomes).toEqual([]);
    expect(second.processedThroughIndex).toBe(1);
    expect(readCommits(bedCommitsFile)).toHaveLength(1); // still just the one commit from `first`
  });

  it('a later run picks up only the new patient commit, not the one already processed', () => {
    let patientContext: PatientContext = commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z') },
    ]);

    const afterAdmission = relayPatientEffectsToBed(patientCommitsFile, createFileOutboxCursor(cursorFile), bedShell(), bedEngine, emptyBedContext, EXAMPLE_firstAvailableBedStrategy, bedIsoTimestamp('2026-07-18T00:01:00.000Z'));

    patientContext = commitPatientInstructions(patientContext, [
      { kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-19T00:00:00.000Z') },
    ]);

    const afterDischarge = relayPatientEffectsToBed(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      bedShell(),
      bedEngine,
      afterAdmission.context,
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-19T00:01:00.000Z'),
    );

    expect(afterDischarge.outcomes).toEqual([{ kind: 'released', encounterId: 'encounter-1', bedId: 'bed-1' }]);
    expect(afterDischarge.processedThroughIndex).toBe(2);
    expect(readCommits(bedCommitsFile)).toHaveLength(2);
  });

  it('safely redelivers an already-processed admission if the cursor is ever behind where bed state actually is', () => {
    commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z') },
    ]);

    const shell = bedShell();
    const first = relayPatientEffectsToBed(patientCommitsFile, createFileOutboxCursor(cursorFile), shell, bedEngine, emptyBedContext, EXAMPLE_firstAvailableBedStrategy, bedIsoTimestamp('2026-07-18T00:01:00.000Z'));
    expect(first.outcomes).toEqual([{ kind: 'assigned', encounterId: 'encounter-1', bedId: 'bed-1' }]);

    // Simulate the worst case this pattern is meant to survive: the
    // cursor's own record of progress is gone (e.g. lost between the bed
    // commit and the cursor advance actually landing on disk) — a fresh
    // cursor file starts back at 0, even though bed-1 is already
    // assigned. Redelivering the same admission must not grab a second
    // bed for it.
    const resetCursor = createFileOutboxCursor(join(dir, 'cursor-reset.jsonl'));
    const redelivered = relayPatientEffectsToBed(
      patientCommitsFile,
      resetCursor,
      shell,
      bedEngine,
      first.context,
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-18T00:02:00.000Z'),
    );

    expect(redelivered.outcomes).toEqual([{ kind: 'already-assigned', encounterId: 'encounter-1', bedId: 'bed-1' }]);
    expect(redelivered.context.beds['bed-1'].status).toBe('occupied');
    expect(redelivered.context.beds['bed-2'].status).toBe('available'); // never touched
  });

  it('advances the cursor even when a reaction cannot be applied, so one stuck entry does not block later ones', () => {
    commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z') },
    ]);

    const noBedsAvailable: BedContext = { beds: {} };

    const result = relayPatientEffectsToBed(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      bedShell(),
      bedEngine,
      noBedsAvailable,
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-18T00:01:00.000Z'),
    );

    expect(result.outcomes).toEqual([{ kind: 'no-bed-available', encounterId: 'encounter-1' }]);
    expect(result.processedThroughIndex).toBe(1); // still advanced — not stuck retrying forever
    expect(readCommits(bedCommitsFile)).toEqual([]); // nothing to commit — no bed effect was produced
  });

  it('composes with a saga-wrapped reactor: a compensated batch still durably commits its net effect and still advances the cursor', () => {
    commitPatientInstructions({ encounters: {} }, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z') },
      { kind: 'AdmitPatient', patientId: patientId('patient-2'), encounterId: encounterId('encounter-2'), admittedAt: isoTimestamp('2026-07-18T00:05:00.000Z') },
    ]);

    const oneAvailableBed: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };

    const result = relayPatientEffectsToBed(
      patientCommitsFile,
      createFileOutboxCursor(cursorFile),
      bedShell(),
      bedEngine,
      oneAvailableBed,
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-18T00:06:00.000Z'),
      (engine, context, effects, strategy, timestamp) =>
        reactToPatientEffectsAsSaga(engine, context, effects, strategy, timestamp, EXAMPLE_allOrNothingSagaPolicy),
    );

    // Reliable delivery (this relay) and all-or-nothing batches (the
    // saga) compose without either needing to know about the other.
    expect(result.outcomes).toEqual([
      { kind: 'assigned', encounterId: 'encounter-1', bedId: 'bed-1' },
      { kind: 'no-bed-available', encounterId: 'encounter-2' },
    ]);
    expect(result.processedThroughIndex).toBe(1);
    expect(result.context).toEqual(oneAvailableBed); // compensated back to the starting state
    // The bed commit log captures the *whole* story, assignment and its
    // compensation both, not just the net-zero end state — the audit
    // trail this codebase cares about throughout is about what actually
    // happened, not just where things ended up.
    const committed = readCommits<BedContext, BedEffect>(bedCommitsFile);
    expect(committed).toHaveLength(1);
    expect(committed[0]!.effects.map((effect) => effect.kind)).toEqual(['BedAssigned', 'BedReleased']);
  });
});
