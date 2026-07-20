type Brand<T, B extends string> = T & { readonly __brand: B };

export type AccountId = Brand<string, 'AccountId'>;
export type EntryId = Brand<string, 'EntryId'>;

export function accountId(value: string): AccountId {
  return value as AccountId;
}

export function entryId(value: string): EntryId {
  return value as EntryId;
}

/** `IsoTimestamp` re-exported, not redefined — see `core/temporal.ts`. */
export { isoTimestamp, type IsoTimestamp } from '../../core/temporal.js';
