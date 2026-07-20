type Brand<T, B extends string> = T & { readonly __brand: B };

export type StudyId = Brand<string, 'StudyId'>;

export function studyId(value: string): StudyId {
  return value as StudyId;
}

/**
 * `EncounterId`/`IsoTimestamp` re-exported, not redefined — same
 * reasoning as `instructions/bed/ids.ts` and `instructions/lab/ids.ts`.
 */
export { encounterId, type EncounterId } from '../patient/ids.js';
export { isoTimestamp, type IsoTimestamp } from '../../core/temporal.js';
