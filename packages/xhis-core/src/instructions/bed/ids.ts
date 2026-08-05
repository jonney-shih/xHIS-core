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
 * `IsoTimestamp` now lives in `core/temporal.ts` — genuinely domain-
 * agnostic, unlike `EncounterId` above. Re-exported here (and from
 * `patient/ids.ts`) so existing imports from either domain's `ids.js`
 * keep working unchanged.
 */
export { isoTimestamp, type IsoTimestamp } from '../../core/temporal.js';
