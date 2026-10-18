type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * `EncounterId` and `StaffId` re-exported, not redefined — the same
 * real-world identifiers `outpatient/ids.ts` already reuses from
 * `patient`/`nursing`, for the identical reason: an admitted encounter
 * and the attending physician recording a progress note are owned by
 * those bounded contexts, not invented fresh here.
 */
export { encounterId, type EncounterId } from '../patient/ids.js';
export { staffId, type StaffId } from '../nursing/ids.js';

export type WardAssignmentId = Brand<string, 'WardAssignmentId'>;
export type ProgressNoteId = Brand<string, 'ProgressNoteId'>;

export function wardAssignmentId(value: string): WardAssignmentId {
  return value as WardAssignmentId;
}

export function progressNoteId(value: string): ProgressNoteId {
  return value as ProgressNoteId;
}

/** `IsoTimestamp` re-exported, not redefined — see `core/temporal.ts`. */
export { isoTimestamp, type IsoTimestamp } from '../../core/temporal.js';
