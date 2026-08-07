type Brand<T, B extends string> = T & { readonly __brand: B };

export type LabOrderId = Brand<string, 'LabOrderId'>;

export function labOrderId(value: string): LabOrderId {
  return value as LabOrderId;
}

/**
 * `EncounterId`/`IsoTimestamp` re-exported, not redefined — same
 * reasoning as `instructions/bed/ids.ts`: an encounter is owned by the
 * clinical/patient bounded context, and a timestamp is owned by no
 * domain at all (see `core/temporal.ts`).
 */
export { encounterId, type EncounterId } from '../patient/ids.js';
export { isoTimestamp, type IsoTimestamp } from '../../core/temporal.js';
