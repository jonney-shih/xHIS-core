import { describe, expect, it } from 'vitest';
import { orderStudyHandler } from '../../../src/instructions/imaging/handlers/orderStudy.js';
import { isoTimestamp, studyId } from '../../../src/instructions/imaging/ids.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { ImagingContext } from '../../../src/instructions/imaging/types.js';

const emptyContext: ImagingContext = { studies: {} };

describe('orderStudyHandler', () => {
  it('orders a study and emits a StudyOrdered effect', () => {
    const result = orderStudyHandler(emptyContext, {
      kind: 'OrderStudy',
      studyId: studyId('study-1'),
      encounterId: encounterId('encounter-1'),
      modality: 'CT',
      orderedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.studies['study-1']).toEqual({
      studyId: 'study-1',
      encounterId: 'encounter-1',
      modality: 'CT',
      status: 'ordered',
      orderedAt: '2026-07-20T00:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'StudyOrdered', studyId: 'study-1', encounterId: 'encounter-1', modality: 'CT', orderedAt: '2026-07-20T00:00:00.000Z' },
    ]);
  });

  it('never mutates the input context', () => {
    const before = JSON.stringify(emptyContext);

    orderStudyHandler(emptyContext, {
      kind: 'OrderStudy',
      studyId: studyId('study-1'),
      encounterId: encounterId('encounter-1'),
      modality: 'CT',
      orderedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
    });

    expect(JSON.stringify(emptyContext)).toBe(before);
  });

  it('rejects ordering the same studyId twice', () => {
    const context: ImagingContext = {
      studies: {
        'study-1': { studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', status: 'ordered', orderedAt: isoTimestamp('2026-07-20T00:00:00.000Z') },
      },
    };

    const result = orderStudyHandler(context, {
      kind: 'OrderStudy',
      studyId: studyId('study-1'),
      encounterId: encounterId('encounter-2'),
      modality: 'MR',
      orderedAt: isoTimestamp('2026-07-20T01:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'StudyAlreadyExists', studyId: 'study-1' } });
  });
});
