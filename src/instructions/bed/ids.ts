type Brand<T, B extends string> = T & { readonly __brand: B };

export type BedId = Brand<string, 'BedId'>;

export function bedId(value: string): BedId {
  return value as BedId;
}

/**
 * `EncounterId` (and its constructor) are deliberately re-exported from
 * the patient domain, not redefined here. An encounter is owned by the
 * clinical/patient bounded context; bed management only ever references
 * it as a foreign key when assigning a bed. Redefining a same-named-but-
 * differently-branded `EncounterId` here would let a bed instruction
 * accept an ID that was never actually a real encounter, and vice versa —
 * the whole point of branding is to make that impossible across domain
 * boundaries too, not just within one.
 */
export { encounterId, type EncounterId } from '../patient/ids.js';

/**
 * `IsoTimestamp` also currently lives in `../patient/ids.ts`, re-exported
 * from there rather than redefined — but unlike `EncounterId`, a
 * timestamp isn't a concept the patient domain "owns"; it's genuinely
 * domain-agnostic. Now that a second domain needs it, that's a sign
 * `IsoTimestamp` (and its constructor) probably belongs in a shared,
 * domain-agnostic location instead of inside `patient/ids.ts` — not
 * changed here since that's a small refactor of existing patient-domain
 * files, not something this domain's own instruction union needs to
 * settle to be written.
 */
export { isoTimestamp, type IsoTimestamp } from '../patient/ids.js';
