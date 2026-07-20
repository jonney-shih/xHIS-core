import { describe, expect, it } from 'vitest';
import { EXAMPLE_firstAvailableBedStrategy } from '../../src/integration/bedSelection.js';
import { reactToPatientEffect, reactToPatientEffects } from '../../src/integration/patientToBed.js';
import type { BedEngineLike } from '../../src/integration/patientToBed.js';
import { bedId, isoTimestamp as bedIsoTimestamp } from '../../src/instructions/bed/ids.js';
import { bedEngine } from '../../src/instructions/bed/engine.js';
import type { BedContext, BedError } from '../../src/instructions/bed/types.js';
import { patientEngine } from '../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect } from '../../src/instructions/patient/types.js';

const twoAvailableBeds: BedContext = {
  beds: {
    'bed-1': { bedId: bedId('bed-1'), status: 'available' },
    'bed-2': { bedId: bedId('bed-2'), status: 'available' },
  },
};

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

const admitted: PatientEffect = {
  kind: 'EncounterAdmitted',
  encounterId: encounterId('encounter-1'),
  patientId: patientId('patient-1'),
  admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
};

const discharged: PatientEffect = {
  kind: 'EncounterDischarged',
  encounterId: encounterId('encounter-1'),
  dischargedAt: isoTimestamp('2026-07-18T01:00:00.000Z'),
};

describe('reactToPatientEffect', () => {
  it('assigns the selected bed for an EncounterAdmitted effect', () => {
    const reaction = reactToPatientEffect(
      admitted,
      twoAvailableBeds,
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-19T00:00:00.000Z'),
    );

    expect(reaction).toEqual({
      kind: 'assign',
      instruction: {
        kind: 'AssignBed',
        bedId: 'bed-1',
        encounterId: 'encounter-1',
        assignedAt: '2026-07-19T00:00:00.000Z',
      },
    });
  });

  it('reports no-bed-available when nothing is free', () => {
    const reaction = reactToPatientEffect(admitted, { beds: {} }, EXAMPLE_firstAvailableBedStrategy, bedIsoTimestamp('2026-07-19T00:00:00.000Z'));

    expect(reaction).toEqual({ kind: 'no-bed-available', encounterId: 'encounter-1' });
  });

  it('releases the bed holding the discharged encounter', () => {
    const reaction = reactToPatientEffect(
      discharged,
      bed1OccupiedByEncounter1,
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-19T00:00:00.000Z'),
    );

    expect(reaction).toEqual({
      kind: 'release',
      instruction: { kind: 'ReleaseBed', bedId: 'bed-1', releasedAt: '2026-07-19T00:00:00.000Z' },
    });
  });

  it('reports no-bed-to-release when no bed holds the discharged encounter', () => {
    const reaction = reactToPatientEffect(discharged, { beds: {} }, EXAMPLE_firstAvailableBedStrategy, bedIsoTimestamp('2026-07-19T00:00:00.000Z'));

    expect(reaction).toEqual({ kind: 'no-bed-to-release', encounterId: 'encounter-1' });
  });

  it('reports ambiguous-bed-assignment rather than picking one, if two beds somehow hold the same encounter', () => {
    const inconsistentContext: BedContext = {
      beds: {
        'bed-1': {
          bedId: bedId('bed-1'),
          status: 'occupied',
          encounterId: encounterId('encounter-1'),
          assignedAt: bedIsoTimestamp('2026-07-18T00:00:00.000Z'),
        },
        'bed-2': {
          bedId: bedId('bed-2'),
          status: 'occupied',
          encounterId: encounterId('encounter-1'),
          assignedAt: bedIsoTimestamp('2026-07-18T00:01:00.000Z'),
        },
      },
    };

    const reaction = reactToPatientEffect(discharged, inconsistentContext, EXAMPLE_firstAvailableBedStrategy, bedIsoTimestamp('2026-07-19T00:00:00.000Z'));

    expect(reaction).toEqual({ kind: 'ambiguous-bed-assignment', encounterId: 'encounter-1', bedIds: ['bed-1', 'bed-2'] });
  });
});

describe('reactToPatientEffects', () => {
  it('assigns a bed for an admission, then releases that same bed for a discharge later in the batch', () => {
    const result = reactToPatientEffects(bedEngine, twoAvailableBeds, [admitted, discharged], EXAMPLE_firstAvailableBedStrategy, bedIsoTimestamp('2026-07-19T00:00:00.000Z'));

    expect(result.outcomes).toEqual([
      { kind: 'assigned', encounterId: 'encounter-1', bedId: 'bed-1' },
      { kind: 'released', encounterId: 'encounter-1', bedId: 'bed-1' },
    ]);
    expect(result.context.beds['bed-1']).toEqual({ bedId: 'bed-1', status: 'available' });
  });

  it('gives two admissions in the same batch two different beds, not the same one twice', () => {
    const secondAdmission: PatientEffect = {
      kind: 'EncounterAdmitted',
      encounterId: encounterId('encounter-2'),
      patientId: patientId('patient-2'),
      admittedAt: isoTimestamp('2026-07-18T00:05:00.000Z'),
    };

    const result = reactToPatientEffects(
      bedEngine,
      twoAvailableBeds,
      [admitted, secondAdmission],
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-19T00:00:00.000Z'),
    );

    expect(result.outcomes).toEqual([
      { kind: 'assigned', encounterId: 'encounter-1', bedId: 'bed-1' },
      { kind: 'assigned', encounterId: 'encounter-2', bedId: 'bed-2' },
    ]);
  });

  it('reports no-bed-available for one admission without blocking a later one that can still get a bed', () => {
    const secondAdmission: PatientEffect = {
      kind: 'EncounterAdmitted',
      encounterId: encounterId('encounter-2'),
      patientId: patientId('patient-2'),
      admittedAt: isoTimestamp('2026-07-18T00:05:00.000Z'),
    };
    const oneAvailableBed: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };

    // Force the first admission to find nothing available by starting
    // from an empty bed set, then let the second run against a context
    // that does have one — proving one failure doesn't short-circuit the
    // rest of the batch the way `executeSequence`'s all-or-nothing
    // contract deliberately does for a single domain's own instructions.
    const result = reactToPatientEffects(bedEngine, { beds: {} }, [admitted], EXAMPLE_firstAvailableBedStrategy, bedIsoTimestamp('2026-07-19T00:00:00.000Z'));
    expect(result.outcomes).toEqual([{ kind: 'no-bed-available', encounterId: 'encounter-1' }]);

    const secondResult = reactToPatientEffects(bedEngine, oneAvailableBed, [secondAdmission], EXAMPLE_firstAvailableBedStrategy, bedIsoTimestamp('2026-07-19T00:00:00.000Z'));
    expect(secondResult.outcomes).toEqual([{ kind: 'assigned', encounterId: 'encounter-2', bedId: 'bed-1' }]);
  });

  it('reports no-bed-to-release for a discharge without blocking a later reaction in the same batch', () => {
    const secondAdmission: PatientEffect = {
      kind: 'EncounterAdmitted',
      encounterId: encounterId('encounter-2'),
      patientId: patientId('patient-2'),
      admittedAt: isoTimestamp('2026-07-18T00:05:00.000Z'),
    };

    // `discharged` refers to encounter-1, which holds no bed in this
    // context — the batch should still process the admission after it.
    const result = reactToPatientEffects(bedEngine, twoAvailableBeds, [discharged, secondAdmission], EXAMPLE_firstAvailableBedStrategy, bedIsoTimestamp('2026-07-19T00:00:00.000Z'));

    expect(result.outcomes).toEqual([
      { kind: 'no-bed-to-release', encounterId: 'encounter-1' },
      { kind: 'assigned', encounterId: 'encounter-2', bedId: 'bed-1' },
    ]);
  });

  it('reports reaction-failed, not a thrown error, when the bed engine rejects an AssignBed instruction', () => {
    const failingEngine: BedEngineLike = {
      execute: () => ({ ok: false, error: { kind: 'BedAlreadyOccupied', bedId: bedId('bed-1') } satisfies BedError }),
    };

    const result = reactToPatientEffects(failingEngine, twoAvailableBeds, [admitted], EXAMPLE_firstAvailableBedStrategy, bedIsoTimestamp('2026-07-19T00:00:00.000Z'));

    expect(result.outcomes).toEqual([
      { kind: 'reaction-failed', encounterId: 'encounter-1', error: { kind: 'BedAlreadyOccupied', bedId: 'bed-1' } },
    ]);
    // Context is unchanged on failure, same as a rejected instruction
    // never being applied anywhere else in this codebase.
    expect(result.context).toEqual(twoAvailableBeds);
  });

  it('reports reaction-failed, not a thrown error, when the bed engine rejects a ReleaseBed instruction', () => {
    const failingEngine: BedEngineLike = {
      execute: () => ({ ok: false, error: { kind: 'BedNotOccupied', bedId: bedId('bed-1') } satisfies BedError }),
    };

    const result = reactToPatientEffects(failingEngine, bed1OccupiedByEncounter1, [discharged], EXAMPLE_firstAvailableBedStrategy, bedIsoTimestamp('2026-07-19T00:00:00.000Z'));

    expect(result.outcomes).toEqual([
      { kind: 'reaction-failed', encounterId: 'encounter-1', error: { kind: 'BedNotOccupied', bedId: 'bed-1' } },
    ]);
  });
});

describe('patient admission/discharge -> bed assignment/release, end to end', () => {
  it('admits two patients, assigns each a bed, discharges one, and releases only that bed', () => {
    const emptyPatientContext: PatientContext = { encounters: {} };

    const admissionOutcome = patientEngine.executeSequence(emptyPatientContext, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z') },
      { kind: 'AdmitPatient', patientId: patientId('patient-2'), encounterId: encounterId('encounter-2'), admittedAt: isoTimestamp('2026-07-18T00:05:00.000Z') },
    ]);
    expect(admissionOutcome.ok).toBe(true);
    if (!admissionOutcome.ok) throw new Error('expected ok');

    const afterAdmission = reactToPatientEffects(
      bedEngine,
      twoAvailableBeds,
      admissionOutcome.value.effects,
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-18T00:06:00.000Z'),
    );
    expect(afterAdmission.outcomes).toEqual([
      { kind: 'assigned', encounterId: 'encounter-1', bedId: 'bed-1' },
      { kind: 'assigned', encounterId: 'encounter-2', bedId: 'bed-2' },
    ]);

    const dischargeOutcome = patientEngine.executeSequence(admissionOutcome.value.context, [
      { kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-19T00:00:00.000Z') },
    ]);
    expect(dischargeOutcome.ok).toBe(true);
    if (!dischargeOutcome.ok) throw new Error('expected ok');

    const afterDischarge = reactToPatientEffects(
      bedEngine,
      afterAdmission.context,
      dischargeOutcome.value.effects,
      EXAMPLE_firstAvailableBedStrategy,
      bedIsoTimestamp('2026-07-19T00:01:00.000Z'),
    );

    expect(afterDischarge.outcomes).toEqual([{ kind: 'released', encounterId: 'encounter-1', bedId: 'bed-1' }]);
    expect(afterDischarge.context.beds['bed-1']).toEqual({ bedId: 'bed-1', status: 'available' });
    expect(afterDischarge.context.beds['bed-2'].status).toBe('occupied');
  });
});
