type Brand<T, B extends string> = T & { readonly __brand: B };

export type PatientId = Brand<string, 'PatientId'>;
export type EncounterId = Brand<string, 'EncounterId'>;

export function patientId(value: string): PatientId {
  return value as PatientId;
}

export function encounterId(value: string): EncounterId {
  return value as EncounterId;
}

/**
 * `IsoTimestamp` used to be defined here. Moved to `core/temporal.ts`
 * once `bed` — a second domain with no reason to depend on the patient
 * domain for a concept neither of them owns — actually needed it too;
 * re-exported from here so nothing importing it from `patient/ids.js`
 * needs to change.
 */
export { isoTimestamp, type IsoTimestamp } from '../../core/temporal.js';
