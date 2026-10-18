type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * `EncounterId`/`PatientId` re-exported, not redefined — same reasoning
 * as `outpatient/ids.ts`/`inpatient/ids.ts`: these are owned by the
 * `patient` bounded context, not invented fresh per domain.
 */
export { encounterId, type EncounterId, patientId, type PatientId } from '../patient/ids.js';

export type EmergencyVisitId = Brand<string, 'EmergencyVisitId'>;

export function emergencyVisitId(value: string): EmergencyVisitId {
  return value as EmergencyVisitId;
}

/** `IsoTimestamp` re-exported, not redefined — see `core/temporal.ts`. */
export { isoTimestamp, type IsoTimestamp } from '../../core/temporal.js';
