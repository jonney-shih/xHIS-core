import { describe, expect, it } from 'vitest';
import { createCdssImagingPlanner } from '../../../src/agentic/planning/cdssImagingPlanner.js';
import type { ImagingDischargeSignal } from '../../../src/agentic/planning/cdssImagingPlanner.js';
import { encounterId, isoTimestamp, studyId } from '../../../src/instructions/imaging/ids.js';
import type { ImagingContext } from '../../../src/instructions/imaging/types.js';
import { patientId } from '../../../src/instructions/patient/ids.js';

const emptyImagingContext: ImagingContext = { studies: {} };

describe('createCdssImagingPlanner', () => {
  it('recommends cancellation of a single pending study for a discharge signal', async () => {
    const planner = createCdssImagingPlanner();
    const context: ImagingContext = {
      studies: {
        'study-1': { studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
      },
    };
    const signal: ImagingDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };

    const result = await planner.plan(
      { description: 'discharge sweep' },
      { imagingContext: context, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      [],
    );

    expect(result).toEqual({
      ok: true,
      value: {
        instructions: [{ kind: 'CancelStudy', studyId: 'study-1', cancelledAt: '2026-08-01T01:00:00.000Z' }],
        rationale: 'CDSS imaging rule: recommending cancellation of 1 pending study(s) across 1 discharge signal(s)',
        modelVersion: 'cdss-imaging-cancellation-rule-engine-v1',
        promptVersion: 'imaging-cancellation-ruleset-v1',
      },
    });
  });

  it('is naturally idempotent: a discharge signal for an encounter with nothing pending produces no recommendation', async () => {
    const planner = createCdssImagingPlanner();
    const context: ImagingContext = {
      studies: {
        'study-1': {
          studyId: studyId('study-1'),
          encounterId: encounterId('encounter-1'),
          modality: 'CT',
          status: 'cancelled',
          orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
          cancelledAt: isoTimestamp('2026-08-01T00:30:00.000Z'),
        },
      },
    };
    const signal: ImagingDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };

    const result = await planner.plan({ description: 'discharge sweep' }, { imagingContext: context, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  it('produces no recommendation for a signal whose encounter has never had any study at all', async () => {
    const planner = createCdssImagingPlanner();
    const signal: ImagingDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };

    const result = await planner.plan({ description: 'discharge sweep' }, { imagingContext: emptyImagingContext, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  /**
   * The many-to-one proof, mirroring `cdssLabPlanner.test.ts`'s own
   * equivalent: one signal, multiple pending studies for the same
   * encounter, must produce one `CancelStudy` per study.
   */
  it('recommends cancellation of every pending study for a single discharge signal, not just one', async () => {
    const planner = createCdssImagingPlanner();
    const context: ImagingContext = {
      studies: {
        'study-2': { studyId: studyId('study-2'), encounterId: encounterId('encounter-1'), modality: 'MRI', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
        'study-1': { studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
      },
    };
    const signal: ImagingDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };

    const result = await planner.plan({ description: 'discharge sweep' }, { imagingContext: context, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // Sorted for determinism, the same guarantee findPendingStudiesForEncounter's own doc comment gives.
    expect(result.value.instructions).toEqual([
      { kind: 'CancelStudy', studyId: 'study-1', cancelledAt: '2026-08-01T01:00:00.000Z' },
      { kind: 'CancelStudy', studyId: 'study-2', cancelledAt: '2026-08-01T01:00:00.000Z' },
    ]);
  });

  it('handles multiple independent discharge signals without any cross-signal interaction', async () => {
    const planner = createCdssImagingPlanner();
    const context: ImagingContext = {
      studies: {
        'study-1': { studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
        'study-2': { studyId: studyId('study-2'), encounterId: encounterId('encounter-2'), modality: 'MRI', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
      },
    };
    const signals: readonly ImagingDischargeSignal[] = [{ encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') }, { encounterId: encounterId('encounter-2'), patientId: patientId('patient-2') }];

    const result = await planner.plan({ description: 'discharge sweep' }, { imagingContext: context, signals }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([
      { kind: 'CancelStudy', studyId: 'study-1', cancelledAt: '2026-08-01T01:00:00.000Z' },
      { kind: 'CancelStudy', studyId: 'study-2', cancelledAt: '2026-08-01T01:00:00.000Z' },
    ]);
  });

  it('ignores feedback — the rule is a pure function of context and signals, not of prior attempts', async () => {
    const planner = createCdssImagingPlanner();
    const context: ImagingContext = {
      studies: { 'study-1': { studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') } },
    };
    const signal: ImagingDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };

    const first = await planner.plan({ description: 'discharge sweep' }, { imagingContext: context, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);
    const second = await planner.plan(
      { description: 'discharge sweep' },
      { imagingContext: context, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      ['some prior feedback that a deterministic rule has no way to act on'],
    );

    expect(first).toEqual(second);
  });
});
