import { describe, expect, it } from 'vitest';
import { MAX_STORAGE_REF_LENGTH, recordStudyStoredHandler } from '../../../src/instructions/imaging/handlers/recordStudyStored.js';
import { isoTimestamp, studyId } from '../../../src/instructions/imaging/ids.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { ImagingContext } from '../../../src/instructions/imaging/types.js';

const contextWithOrderedStudy: ImagingContext = {
  studies: {
    'study-1': { studyId: studyId('study-1'), encounterId: encounterId('encounter-1'), modality: 'CT', status: 'ordered', orderedAt: isoTimestamp('2026-07-20T00:00:00.000Z') },
  },
};

describe('recordStudyStoredHandler', () => {
  it('records a realistic storage reference and emits a StudyStored effect', () => {
    const result = recordStudyStoredHandler(contextWithOrderedStudy, {
      kind: 'RecordStudyStored',
      studyId: studyId('study-1'),
      storageRef: 's3://pacs-bucket/studies/study-1/series-1.dcm',
      performedAt: isoTimestamp('2026-07-20T01:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.studies['study-1']).toEqual({
      studyId: 'study-1',
      encounterId: 'encounter-1',
      modality: 'CT',
      status: 'performed',
      orderedAt: '2026-07-20T00:00:00.000Z',
      performedAt: '2026-07-20T01:00:00.000Z',
      storageRef: 's3://pacs-bucket/studies/study-1/series-1.dcm',
    });
    expect(result.value.effects).toEqual([
      {
        kind: 'StudyStored',
        studyId: 'study-1',
        encounterId: 'encounter-1',
        storageRef: 's3://pacs-bucket/studies/study-1/series-1.dcm',
        performedAt: '2026-07-20T01:00:00.000Z',
      },
    ]);
  });

  it('rejects recording storage for a study that does not exist', () => {
    const result = recordStudyStoredHandler(
      { studies: {} },
      { kind: 'RecordStudyStored', studyId: studyId('study-1'), storageRef: 'ref', performedAt: isoTimestamp('2026-07-20T01:00:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'StudyNotFound', studyId: 'study-1' } });
  });

  it('rejects recording storage for a study that is not in the ordered state', () => {
    const alreadyPerformed: ImagingContext = {
      studies: {
        'study-1': { ...contextWithOrderedStudy.studies['study-1']!, status: 'performed', performedAt: isoTimestamp('2026-07-20T01:00:00.000Z'), storageRef: 'ref-1' },
      },
    };

    const result = recordStudyStoredHandler(alreadyPerformed, {
      kind: 'RecordStudyStored',
      studyId: studyId('study-1'),
      storageRef: 'ref-2',
      performedAt: isoTimestamp('2026-07-20T02:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'StudyNotOrdered', studyId: 'study-1' } });
  });

  it('accepts a storage reference exactly at the length limit', () => {
    const refAtLimit = 's3://pacs-bucket/'.padEnd(MAX_STORAGE_REF_LENGTH, 'x');
    expect(refAtLimit).toHaveLength(MAX_STORAGE_REF_LENGTH);

    const result = recordStudyStoredHandler(contextWithOrderedStudy, {
      kind: 'RecordStudyStored',
      studyId: studyId('study-1'),
      storageRef: refAtLimit,
      performedAt: isoTimestamp('2026-07-20T01:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
  });

  it('rejects a storage reference over the length limit — the reference-by-ID discipline is enforced, not just documented', () => {
    // Simulates a caller mistakenly passing an embedded, base64-shaped
    // blob through `storageRef` instead of a real pointer — exactly what
    // this check exists to catch.
    const embeddedBlob = 'a'.repeat(MAX_STORAGE_REF_LENGTH + 1);

    const result = recordStudyStoredHandler(contextWithOrderedStudy, {
      kind: 'RecordStudyStored',
      studyId: studyId('study-1'),
      storageRef: embeddedBlob,
      performedAt: isoTimestamp('2026-07-20T01:00:00.000Z'),
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'StorageRefTooLarge', studyId: 'study-1', length: MAX_STORAGE_REF_LENGTH + 1, maxLength: MAX_STORAGE_REF_LENGTH },
    });
  });
});
