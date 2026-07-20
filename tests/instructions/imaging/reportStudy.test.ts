import { describe, expect, it } from 'vitest';
import { reportStudyHandler } from '../../../src/instructions/imaging/handlers/reportStudy.js';
import { isoTimestamp, studyId } from '../../../src/instructions/imaging/ids.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { ImagingContext } from '../../../src/instructions/imaging/types.js';

const contextWithPerformedStudy: ImagingContext = {
  studies: {
    'study-1': {
      studyId: studyId('study-1'),
      encounterId: encounterId('encounter-1'),
      modality: 'CT',
      status: 'performed',
      orderedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
      performedAt: isoTimestamp('2026-07-20T01:00:00.000Z'),
      storageRef: 's3://pacs-bucket/studies/study-1/series-1.dcm',
    },
  },
};

describe('reportStudyHandler', () => {
  it('records the report and emits a StudyReported effect', () => {
    const result = reportStudyHandler(contextWithPerformedStudy, {
      kind: 'ReportStudy',
      studyId: studyId('study-1'),
      reportText: 'No acute findings.',
      reportedAt: isoTimestamp('2026-07-20T02:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.studies['study-1']).toEqual({
      ...contextWithPerformedStudy.studies['study-1'],
      status: 'reported',
      reportText: 'No acute findings.',
      reportedAt: '2026-07-20T02:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'StudyReported', studyId: 'study-1', encounterId: 'encounter-1', reportText: 'No acute findings.', reportedAt: '2026-07-20T02:00:00.000Z' },
    ]);
  });

  it('rejects reporting a study that does not exist', () => {
    const result = reportStudyHandler(
      { studies: {} },
      { kind: 'ReportStudy', studyId: studyId('study-1'), reportText: 'x', reportedAt: isoTimestamp('2026-07-20T02:00:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'StudyNotFound', studyId: 'study-1' } });
  });

  it('rejects reporting a study that has not been performed yet', () => {
    const stillOrdered: ImagingContext = {
      studies: {
        'study-1': { studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', status: 'ordered', orderedAt: isoTimestamp('2026-07-20T00:00:00.000Z') },
      },
    };

    const result = reportStudyHandler(stillOrdered, {
      kind: 'ReportStudy',
      studyId: studyId('study-1'),
      reportText: 'x',
      reportedAt: isoTimestamp('2026-07-20T02:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'StudyNotPerformed', studyId: 'study-1' } });
  });
});
