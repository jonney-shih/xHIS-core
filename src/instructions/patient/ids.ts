type Brand<T, B extends string> = T & { readonly __brand: B };

export type PatientId = Brand<string, 'PatientId'>;
export type EncounterId = Brand<string, 'EncounterId'>;

/** An ISO-8601 timestamp. Instructions carry the timestamp they need rather
 * than handlers reaching for the system clock themselves — see the
 * determinism principle in docs/ARCHITECTURE.md (and the guard test, whose
 * banned-identifier patterns are why this comment avoids spelling out the
 * literal API names it's describing). */
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
