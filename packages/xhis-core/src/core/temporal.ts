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

/**
 * A logical sequence number — "happened before/after," expressed as an
 * integer position in an event log, never as a duration or wall-clock
 * value. Exists so that code which only needs *ordering* (which of two
 * committed things came first) has a typed alternative to reaching for
 * `IsoTimestamp` and comparing strings, or worse, reaching for the system
 * clock to break a tie. Like `IsoTimestamp`, this is plain data a caller
 * assigns and passes in (e.g. the index of an instruction within a
 * batch, or a durable cursor position) — never something this module or
 * any handler generates by observing "now," which would reintroduce the
 * exact ambient-time dependency `IsoTimestamp`'s own doc comment and
 * `determinism.guard.test.ts` exist to keep out.
 */
export type Tick = Brand<number, 'Tick'>;

export function tick(value: number): Tick {
  return value as Tick;
}
