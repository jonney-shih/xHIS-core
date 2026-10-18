type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * `EncounterId`/`PatientId` and `StaffId` are deliberately re-exported
 * from `patient`/`nursing` here rather than re-declared, the same
 * reasoning `bed/ids.ts` already gives for `EncounterId`: an outpatient
 * visit's encounter and the staff member authoring its SOAP note are
 * the same real-world concepts those domains already model, not
 * outpatient-specific ones. A differently-branded copy here would let a
 * `patient`-domain encounter ID or a `nursing`-domain staff ID be passed
 * to an outpatient instruction without TypeScript ever noticing they
 * don't actually refer to the same identifier space.
 */
export { encounterId, type EncounterId, patientId, type PatientId } from '../patient/ids.js';
export { staffId, type StaffId } from '../nursing/ids.js';

export type SoapNoteId = Brand<string, 'SoapNoteId'>;
export type CpoeOrderId = Brand<string, 'CpoeOrderId'>;

export function soapNoteId(value: string): SoapNoteId {
  return value as SoapNoteId;
}

export function cpoeOrderId(value: string): CpoeOrderId {
  return value as CpoeOrderId;
}

/** `IsoTimestamp` re-exported, not redefined — see `core/temporal.ts`. */
export { isoTimestamp, type IsoTimestamp } from '../../core/temporal.js';
