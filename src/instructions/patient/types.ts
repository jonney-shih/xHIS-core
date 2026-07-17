import type { EncounterId, IsoTimestamp, PatientId } from './ids.js';

export interface EncounterRecord {
  readonly encounterId: EncounterId;
  readonly patientId: PatientId;
  readonly status: 'admitted' | 'discharged';
  readonly admittedAt: IsoTimestamp;
  readonly dischargedAt?: IsoTimestamp;
}

/** Plain, JSON-serializable state — no class instances or function-valued
 * fields, so it can be logged, replayed, and diffed for audit purposes. */
export interface PatientContext {
  readonly encounters: Readonly<Record<string, EncounterRecord>>;
}

export type PatientInstruction =
  | {
      readonly kind: 'AdmitPatient';
      readonly patientId: PatientId;
      readonly encounterId: EncounterId;
      readonly admittedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'DischargePatient';
      readonly encounterId: EncounterId;
      readonly dischargedAt: IsoTimestamp;
    };

export type PatientEffect =
  | {
      readonly kind: 'EncounterAdmitted';
      readonly encounterId: EncounterId;
      readonly patientId: PatientId;
      readonly admittedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'EncounterDischarged';
      readonly encounterId: EncounterId;
      readonly dischargedAt: IsoTimestamp;
    };

export type PatientError =
  | { readonly kind: 'EncounterAlreadyExists'; readonly encounterId: EncounterId }
  | { readonly kind: 'EncounterNotFound'; readonly encounterId: EncounterId }
  | { readonly kind: 'EncounterNotAdmitted'; readonly encounterId: EncounterId };
