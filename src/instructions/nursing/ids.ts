type Brand<T, B extends string> = T & { readonly __brand: B };

export type StaffId = Brand<string, 'StaffId'>;
export type CredentialId = Brand<string, 'CredentialId'>;
export type RoleGrantId = Brand<string, 'RoleGrantId'>;

export function staffId(value: string): StaffId {
  return value as StaffId;
}

export function credentialId(value: string): CredentialId {
  return value as CredentialId;
}

export function roleGrantId(value: string): RoleGrantId {
  return value as RoleGrantId;
}

/** `IsoTimestamp` re-exported, not redefined — see `core/temporal.ts`. */
export { isoTimestamp, type IsoTimestamp } from '../../core/temporal.js';
