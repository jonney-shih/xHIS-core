type Brand<T, B extends string> = T & { readonly __brand: B };

export type PrescriptionId = Brand<string, 'PrescriptionId'>;

export function prescriptionId(value: string): PrescriptionId {
  return value as PrescriptionId;
}

/**
 * `EncounterId`/`IsoTimestamp` re-exported, not redefined — same
 * reasoning as `instructions/bed/ids.ts` and `instructions/lab/ids.ts`:
 * an encounter is owned by the clinical/patient bounded context, and a
 * timestamp is owned by no domain at all (see `core/temporal.ts`).
 */
export { encounterId, type EncounterId } from '../patient/ids.js';
export { isoTimestamp, type IsoTimestamp } from '../../core/temporal.js';
