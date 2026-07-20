import { describe, expect, it } from 'vitest';
import { EXAMPLE_firstAvailableBedStrategy } from '../../src/integration/bedSelection.js';
import { EXAMPLE_allOrNothingSagaPolicy, reactToPatientEffectsAsSaga } from '../../src/integration/patientBedSaga.js';
import type { BedEngineLike } from '../../src/integration/patientToBed.js';
import { bedEngine } from '../../src/instructions/bed/engine.js';
import { bedId, isoTimestamp as bedIsoTimestamp } from '../../src/instructions/bed/ids.js';
import type { BedContext, BedError } from '../../src/instructions/bed/types.js';
import { encounterId, isoTimestamp, patientId } from '../../src/instructions/patient/ids.js';
import type { PatientEffect } from '../../src/instructions/patient/types.js';

const oneAvailableBed: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };

const admitEncounter1: PatientEffect = {
  kind: 'EncounterAdmitted',
  encounterId: encounterId('encounter-1'),
  patientId: patientId('patient-1'),
  admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
};

const admitEncounter2: PatientEffect = {
  kind: 'EncounterAdmitted',
  encounterId: encounterId('encounter-2'),
  patientId: patientId('patient-2'),
  admittedAt: isoTimestamp('2026-07-18T00:05:00.000Z'),
};

describe('reactToPatientEffectsAsSaga', () => {
  it('stands as-is, with no compensation, when the whole batch succeeds', () => {
    const twoAvailableBeds: BedContext = {
      beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' }, 'bed-2': { bedId: bedId('bed-2'), status: 'available' } },
    };

    const result = reactToPatientEffectsAsSaga(
      bedEngine,
      twoAvailableBeds,
      [admitEncounter1, admitEncounter2],
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-19T00:00:00.000Z'),
      EXAMPLE_allOrNothingSagaPolicy,
    );

    expect(result.compensation).toBeUndefined();
    expect(result.outcomes).toEqual([
      { kind: 'assigned', encounterId: 'encounter-1', bedId: 'bed-1' },
      { kind: 'assigned', encounterId: 'encounter-2', bedId: 'bed-2' },
    ]);
  });

  it('compensates a successful assignment when a later admission in the same batch has no bed available', () => {
    const result = reactToPatientEffectsAsSaga(
      bedEngine,
      oneAvailableBed,
      [admitEncounter1, admitEncounter2],
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-19T00:00:00.000Z'),
      EXAMPLE_allOrNothingSagaPolicy,
    );

    expect(result.outcomes).toEqual([
      { kind: 'assigned', encounterId: 'encounter-1', bedId: 'bed-1' },
      { kind: 'no-bed-available', encounterId: 'encounter-2' },
    ]);
    expect(result.compensation).toEqual({
      reason: { kind: 'no-bed-available', encounterId: 'encounter-2' },
      compensatingOutcomes: [{ kind: 'released', encounterId: 'encounter-1', bedId: 'bed-1' }],
    });
    // Net effect of the whole batch is a no-op: back to where it started.
    expect(result.context).toEqual(oneAvailableBed);
  });

  it('does not compensate for a benign already-assigned outcome (redelivery safety)', () => {
    const alreadyOccupied: BedContext = {
      beds: {
        'bed-1': {
          bedId: bedId('bed-1'),
          status: 'occupied',
          encounterId: encounterId('encounter-1'),
          assignedAt: bedIsoTimestamp('2026-07-18T00:00:00.000Z'),
        },
      },
    };

    const result = reactToPatientEffectsAsSaga(
      bedEngine,
      alreadyOccupied,
      [admitEncounter1],
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-19T00:00:00.000Z'),
      EXAMPLE_allOrNothingSagaPolicy,
    );

    expect(result.outcomes).toEqual([{ kind: 'already-assigned', encounterId: 'encounter-1', bedId: 'bed-1' }]);
    expect(result.compensation).toBeUndefined();
  });

  it('compensates a successful release when a later reaction in the same batch fails', () => {
    const bed1OccupiedByEncounter1: BedContext = {
      beds: {
        'bed-1': {
          bedId: bedId('bed-1'),
          status: 'occupied',
          encounterId: encounterId('encounter-1'),
          assignedAt: bedIsoTimestamp('2026-07-18T00:00:00.000Z'),
        },
      },
    };
    const discharged1: PatientEffect = { kind: 'EncounterDischarged', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-18T01:00:00.000Z') };

    // A fake engine that fails only the specific AssignBed intended for
    // encounter-2 — not by call order, since compensation makes a *third*
    // call (re-assigning bed-1 back to encounter-1) that must succeed for
    // this test to actually prove anything.
    const failsAssignForEncounter2: BedEngineLike = {
      execute(context, instruction) {
        if (instruction.kind === 'AssignBed' && instruction.encounterId === encounterId('encounter-2')) {
          return { ok: false, error: { kind: 'BedNotFound', bedId: instruction.bedId } satisfies BedError };
        }
        return bedEngine.execute(context, instruction);
      },
    };

    const result = reactToPatientEffectsAsSaga(
      failsAssignForEncounter2,
      bed1OccupiedByEncounter1,
      [discharged1, admitEncounter2],
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-19T00:00:00.000Z'),
      EXAMPLE_allOrNothingSagaPolicy,
    );

    // encounter-2's assignment was attempted against bed-1, the only bed
    // that exists here — it becomes available the moment encounter-1's
    // discharge releases it.
    expect(result.outcomes).toEqual([
      { kind: 'released', encounterId: 'encounter-1', bedId: 'bed-1' },
      { kind: 'reaction-failed', encounterId: 'encounter-2', error: { kind: 'BedNotFound', bedId: 'bed-1' } },
    ]);
    expect(result.compensation?.compensatingOutcomes).toEqual([{ kind: 'assigned', encounterId: 'encounter-1', bedId: 'bed-1' }]);
    expect(result.context.beds['bed-1']).toEqual({
      bedId: 'bed-1',
      status: 'occupied',
      encounterId: 'encounter-1',
      assignedAt: '2026-07-19T00:00:00.000Z',
    });
  });

  it('reports a failed compensation as reaction-failed rather than throwing', () => {
    const alwaysFailsToRelease: BedEngineLike = {
      execute(context, instruction) {
        if (instruction.kind === 'ReleaseBed') {
          return { ok: false, error: { kind: 'BedNotOccupied', bedId: instruction.bedId } satisfies BedError };
        }
        return bedEngine.execute(context, instruction);
      },
    };

    const result = reactToPatientEffectsAsSaga(
      alwaysFailsToRelease,
      oneAvailableBed,
      [admitEncounter1, admitEncounter2],
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-19T00:00:00.000Z'),
      EXAMPLE_allOrNothingSagaPolicy,
    );

    expect(result.compensation?.reason).toEqual({ kind: 'no-bed-available', encounterId: 'encounter-2' });
    expect(result.compensation?.compensatingOutcomes).toEqual([
      { kind: 'reaction-failed', encounterId: 'encounter-1', error: { kind: 'BedNotOccupied', bedId: 'bed-1' } },
    ]);
    // The failed compensation didn't revert anything — bed-1 stays
    // assigned, an inconsistency this module surfaces but can't itself
    // fix, same as any other reaction-failed outcome.
    expect(result.context.beds['bed-1'].status).toBe('occupied');
  });
});
