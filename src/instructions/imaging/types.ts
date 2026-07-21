import type { EncounterId, IsoTimestamp, StudyId } from './ids.js';

/**
 * The sixth domain, and the first built to test a *known boundary*
 * rather than a "hard core" family (see docs/DETERMINISTIC_CORE_PATTERN.md's
 * "Known boundaries" section): large binary objects (PACS/DICOM) don't
 * fit a plain-JSON context. `ImagingContext` never holds pixel data —
 * `StudyRecord.storageRef` is a plain string *reference* (an object-store
 * key or URI) to wherever the actual image bytes live, the same
 * reference-by-ID discipline `EncounterId` already models for
 * cross-domain foreign keys, applied here to an out-of-process resource
 * instead of another domain's record.
 *
 * That discipline is enforced, not just documented — see
 * `handlers/recordStudyStored.ts`'s `MAX_STORAGE_REF_LENGTH` check, the
 * domain-specific invariant proof for this boundary.
 */
export interface StudyRecord {
  readonly studyId: StudyId;
  readonly encounterId: EncounterId;
  readonly modality: string;
  readonly status: 'ordered' | 'performed' | 'reported' | 'cancelled';
  readonly orderedAt: IsoTimestamp;
  readonly performedAt?: IsoTimestamp;
  readonly storageRef?: string;
  readonly reportText?: string;
  readonly reportedAt?: IsoTimestamp;
  readonly cancelledAt?: IsoTimestamp;
}

/** Plain, JSON-serializable state — see `PatientContext`'s doc comment
 * for why that matters, and this file's own doc comment for why it's
 * especially load-bearing here. */
export interface ImagingContext {
  readonly studies: Readonly<Record<string, StudyRecord>>;
}

/**
 * Four instructions, same restraint as `lab` — specimen-equivalent
 * concepts (multi-series studies, addenda to a signed report, priors
 * comparison) are real parts of a PACS/RIS lifecycle and deliberately
 * out of scope here, same reasoning `lab/types.ts` already applies to
 * its own domain. `CancelStudy` exists for the same reason `lab`'s
 * `CancelLabOrder` does — closing the asymmetry docs/DETERMINISTIC_CORE_PATTERN.md
 * flagged: a still-pending, un-performed study had no way to be
 * resolved when its encounter is discharged, unlike lab's pending
 * orders.
 */
export type ImagingInstruction =
  | {
      readonly kind: 'OrderStudy';
      readonly studyId: StudyId;
      readonly encounterId: EncounterId;
      readonly modality: string;
      readonly orderedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'RecordStudyStored';
      readonly studyId: StudyId;
      readonly storageRef: string;
      readonly performedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'ReportStudy';
      readonly studyId: StudyId;
      readonly reportText: string;
      readonly reportedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'CancelStudy';
      readonly studyId: StudyId;
      readonly cancelledAt: IsoTimestamp;
    };

export type ImagingEffect =
  | {
      readonly kind: 'StudyOrdered';
      readonly studyId: StudyId;
      readonly encounterId: EncounterId;
      readonly modality: string;
      readonly orderedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'StudyStored';
      readonly studyId: StudyId;
      readonly encounterId: EncounterId;
      readonly storageRef: string;
      readonly performedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'StudyReported';
      readonly studyId: StudyId;
      readonly encounterId: EncounterId;
      readonly reportText: string;
      readonly reportedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'StudyCancelled';
      readonly studyId: StudyId;
      readonly encounterId: EncounterId;
      readonly cancelledAt: IsoTimestamp;
    };

export type ImagingError =
  | { readonly kind: 'StudyAlreadyExists'; readonly studyId: StudyId }
  | { readonly kind: 'StudyNotFound'; readonly studyId: StudyId }
  | { readonly kind: 'StudyNotOrdered'; readonly studyId: StudyId }
  | { readonly kind: 'StudyNotPerformed'; readonly studyId: StudyId }
  | {
      readonly kind: 'StorageRefTooLarge';
      readonly studyId: StudyId;
      readonly length: number;
      readonly maxLength: number;
    };
