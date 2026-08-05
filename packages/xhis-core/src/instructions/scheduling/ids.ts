type Brand<T, B extends string> = T & { readonly __brand: B };

export type ResourceId = Brand<string, 'ResourceId'>;
export type BookingId = Brand<string, 'BookingId'>;

export function resourceId(value: string): ResourceId {
  return value as ResourceId;
}

export function bookingId(value: string): BookingId {
  return value as BookingId;
}

/** `IsoTimestamp` re-exported, not redefined — see `core/temporal.ts`. */
export { isoTimestamp, type IsoTimestamp } from '../../core/temporal.js';
