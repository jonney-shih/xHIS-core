import { describe, expect, it } from 'vitest';
import { cancelStudyHandler } from '../../../src/instructions/imaging/handlers/cancelStudy.js';
import { isoTimestamp, studyId } from '../../../src/instructions/imaging/ids.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { ImagingContext } from '../../../src/instructions/imaging/types.js';

const contextWithOrderedStudy: ImagingContext = {
  studies: {
    'study-1': {
      studyId: studyId('study-1'),
      encounterId: encounterId('encounter-1'),
      modality: 'CT',
      status: 'ordered',
      orderedAt: isoTimestamp('2026-07-21T00:00:00.000Z'),
    },
  },
};

describe('cancelStudyHandler', () => {
  it('cancels a still-ordered study and emits a StudyCancelled effect', () => {
    const result = cancelStudyHandler(contextWithOrderedStudy, {
      kind: 'CancelStudy',
      studyId: studyId('study-1'),
      cancelledAt: isoTimestamp('2026-07-21T01:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.studies['study-1']).toEqual({
      studyId: 'study-1',
      encounterId: 'encounter-1',
      modality: 'CT',
      status: 'cancelled',
      orderedAt: '2026-07-21T00:00:00.000Z',
      cancelledAt: '2026-07-21T01:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'StudyCancelled', studyId: 'study-1', encounterId: 'encounter-1', cancelledAt: '2026-07-21T01:00:00.000Z' },
    ]);
  });

  it('never mutates the input context', () => {
    const before = JSON.stringify(contextWithOrderedStudy);

    cancelStudyHandler(contextWithOrderedStudy, {
      kind: 'CancelStudy',
      studyId: studyId('study-1'),
      cancelledAt: isoTimestamp('2026-07-21T01:00:00.000Z'),
    });

    expect(JSON.stringify(contextWithOrderedStudy)).toBe(before);
  });

  it('rejects cancelling a study that does not exist', () => {
    const result = cancelStudyHandler(
      { studies: {} },
      { kind: 'CancelStudy', studyId: studyId('study-1'), cancelledAt: isoTimestamp('2026-07-21T01:00:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'StudyNotFound', studyId: 'study-1' } });
  });

  it('rejects cancelling a study that has already been performed', () => {
    const performedContext: ImagingContext = {
      studies: {
        'study-1': { ...contextWithOrderedStudy.studies['study-1']!, status: 'performed', performedAt: isoTimestamp('2026-07-21T00:30:00.000Z'), storageRef: 's3://pacs-bucket/study-1' },
      },
    };

    const result = cancelStudyHandler(performedContext, {
      kind: 'CancelStudy',
      studyId: studyId('study-1'),
      cancelledAt: isoTimestamp('2026-07-21T01:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'StudyNotOrdered', studyId: 'study-1' } });
  });

  it('rejects cancelling a study that has already been reported', () => {
    const reportedContext: ImagingContext = {
      studies: {
        'study-1': {
          ...contextWithOrderedStudy.studies['study-1']!,
          status: 'reported',
          performedAt: isoTimestamp('2026-07-21T00:30:00.000Z'),
          storageRef: 's3://pacs-bucket/study-1',
          reportText: 'No acute findings.',
          reportedAt: isoTimestamp('2026-07-21T00:45:00.000Z'),
        },
      },
    };

    const result = cancelStudyHandler(reportedContext, {
      kind: 'CancelStudy',
      studyId: studyId('study-1'),
      cancelledAt: isoTimestamp('2026-07-21T01:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'StudyNotOrdered', studyId: 'study-1' } });
  });

  it('rejects cancelling a study that has already been cancelled', () => {
    const alreadyCancelledContext: ImagingContext = {
      studies: {
        'study-1': { ...contextWithOrderedStudy.studies['study-1']!, status: 'cancelled', cancelledAt: isoTimestamp('2026-07-21T00:30:00.000Z') },
      },
    };

    const result = cancelStudyHandler(alreadyCancelledContext, {
      kind: 'CancelStudy',
      studyId: studyId('study-1'),
      cancelledAt: isoTimestamp('2026-07-21T01:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'StudyNotOrdered', studyId: 'study-1' } });
  });
});
