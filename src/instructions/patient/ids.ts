type Brand<T, B extends string> = T & { readonly __brand: B };

export type PatientId = Brand<string, 'PatientId'>;
export type EncounterId = Brand<string, 'EncounterId'>;

/** An ISO-8601 timestamp. Instructions carry the timestamp they need rather
 * than handlers calling `Date.now()`/`new Date()` themselves — see the
 * determinism principle in docs/ARCHITECTURE.md. */
export type IsoTimestamp = Brand<string, 'IsoTimestamp'>;

export function patientId(value: string): PatientId {
  return value as PatientId;
}

export function encounterId(value: string): EncounterId {
  return value as EncounterId;
}

export function isoTimestamp(value: string): IsoTimestamp {
  return value as IsoTimestamp;
}
