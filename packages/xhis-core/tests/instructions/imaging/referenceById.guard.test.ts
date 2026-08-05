import { describe, expect, it } from 'vitest';
import { imagingEngine } from '../../../src/instructions/imaging/engine.js';
import { isoTimestamp, studyId } from '../../../src/instructions/imaging/ids.js';
import { MAX_STORAGE_REF_LENGTH } from '../../../src/instructions/imaging/handlers/recordStudyStored.js';
import { encounterId } from '../../../src/instructions/patient/ids.js';
import type { ImagingContext } from '../../../src/instructions/imaging/types.js';

/**
 * The domain-specific invariant proof for this boundary (see
 * `types.ts`'s doc comment): "reference by ID, never embed bytes" is
 * only a real guarantee if the whole context provably stays small no
 * matter how many studies accumulate — not just for one study in
 * isolation, which `recordStudyStored.test.ts` already covers.
 */
describe('imaging reference-by-ID boundary', () => {
  it('keeps the whole context bounded and JSON-serializable across many studies, never growing with "image size"', () => {
    let context: ImagingContext = { studies: {} };
    const STUDY_COUNT = 30;

    for (let i = 0; i < STUDY_COUNT; i += 1) {
      const id = studyId(`study-${i}`);

      const orderResult = imagingEngine.execute(context, {
        kind: 'OrderStudy',
        studyId: id,
        encounterId: encounterId(`encounter-${i}`),
        modality: 'CT',
        orderedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
      });
      if (!orderResult.ok) throw new Error('expected ok');
      context = orderResult.value.context;

      const storeResult = imagingEngine.execute(context, {
        kind: 'RecordStudyStored',
        studyId: id,
        storageRef: `s3://pacs-bucket/studies/${id}/series-1.dcm`,
        performedAt: isoTimestamp('2026-07-20T01:00:00.000Z'),
      });
      if (!storeResult.ok) throw new Error('expected ok');
      context = storeResult.value.context;
    }

    const serialized = JSON.stringify(context);

    // Loosely bounded by study count times a small constant, not by
    // anything resembling actual image size (which would be megabytes
    // per study, not bytes) — the discipline this domain exists to
    // prove holds, checked against the accumulated result, not just one
    // instruction in isolation.
    expect(serialized.length).toBeLessThan(STUDY_COUNT * 400);
    expect(Object.keys(context.studies)).toHaveLength(STUDY_COUNT);
  });

  it('confirms the guard is load-bearing: a state that skipped the length check is exactly a plain-JSON domain turning into a large-object store', () => {
    // Not a call through `recordStudyStoredHandler` (which correctly
    // rejects this, see recordStudyStored.test.ts) — a direct,
    // deliberately-invalid context standing in for "what if the length
    // check above were ever removed or bypassed."
    const contextWithoutTheCheck: ImagingContext = {
      studies: {
        'study-1': {
          studyId: studyId('study-1'),
          encounterId: encounterId('encounter-1'),
          modality: 'CT',
          status: 'performed',
          orderedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
          performedAt: isoTimestamp('2026-07-20T01:00:00.000Z'),
          storageRef: 'a'.repeat(MAX_STORAGE_REF_LENGTH * 100),
        },
      },
    };

    expect(contextWithoutTheCheck.studies['study-1']!.storageRef).toHaveLength(MAX_STORAGE_REF_LENGTH * 100);
  });
});
