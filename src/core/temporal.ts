type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * An ISO-8601 timestamp. Instructions carry the timestamp they need
 * rather than handlers reaching for the system clock themselves — see
 * the determinism principle in docs/ARCHITECTURE.md (and the guard
 * test, whose banned-identifier patterns are why this comment avoids
 * spelling out the literal API names it's describing).
 *
 * Domain-agnostic on purpose, unlike `PatientId`/`EncounterId`/`BedId` —
 * a timestamp isn't a concept any one domain owns, so it lives here
 * under `core/` alongside `execution/` and `io/` rather than inside any
 * one domain's `ids.ts`. This used to be defined in
 * `instructions/patient/ids.ts` and was re-exported by
 * `instructions/bed/ids.ts` once a second domain needed it — moved here
 * once that second, real need actually existed (see
 * docs/DETERMINISTIC_CORE_PATTERN.md's "Event bus vs. federated
 * subscription" for why that timing mattered).
 */
export type IsoTimestamp = Brand<string, 'IsoTimestamp'>;

export function isoTimestamp(value: string): IsoTimestamp {
  return value as IsoTimestamp;
}
